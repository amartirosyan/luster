"""Lustre screensaver handoff for Home Assistant."""

from __future__ import annotations

import json
import re
import time

from aiohttp import web
import voluptuous as vol

from homeassistant.components import webhook
from homeassistant.const import CONF_ENTITY_ID
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.network import NoURLAvailableError, get_url
from homeassistant.helpers.typing import ConfigType

from .const import APP_ID, DOMAIN, PLATFORMS, SHARE_WINDOW, WEBHOOK_ID

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
PAIR_ID = re.compile(r"^[0-9a-f]{32}$")

OPEN_SCHEMA = vol.Schema({vol.Required(CONF_ENTITY_ID): cv.entity_id})
OFFER_SCHEMA = OPEN_SCHEMA


def tv_entities(entry) -> list[str]:
    """Televisions chosen for this integration."""
    raw = entry.options.get("tvs", entry.data.get("tvs") or [])
    if isinstance(raw, str):
        raw = [raw]
    return [entity for entity in raw if isinstance(entity, str) and entity.startswith("media_player.")]


def hook_url(hass: HomeAssistant, webhook_id: str) -> str:
    """Address the television can post to. Prefers the local network URL."""
    try:
        base = get_url(hass, allow_internal=True, allow_external=True, prefer_external=False)
    except NoURLAvailableError as err:
        raise HomeAssistantError(
            "Set a local network URL that the televisions can reach, under Settings, System, Network."
        ) from err
    return f"{base.rstrip('/')}/api/webhook/{webhook_id}"


def current_share(runtime: dict) -> dict | None:
    """The screensaver pair, if it is still inside the hour."""
    share = runtime.get("share")
    if not share:
        return None
    if time.time() - share["received"] > SHARE_WINDOW:
        return None
    return share


def _entry_for(hass: HomeAssistant, entity_id: str):
    entries = hass.config_entries.async_entries(DOMAIN)
    if not entries:
        raise HomeAssistantError("The Lustre integration is not set up.")
    for entry in entries:
        if entity_id in tv_entities(entry):
            return entry
    return entries[0]


async def async_launch(hass: HomeAssistant, entry, entity_id: str, offer: bool) -> None:
    """Open Lustre on one television."""
    if not hass.services.has_service("webostv", "command"):
        raise HomeAssistantError("The LG webOS TV integration is not set up.")
    runtime = hass.data[DOMAIN][entry.entry_id]
    params = {"hook": hook_url(hass, entry.data["webhook_id"])}
    if offer:
        share = current_share(runtime)
        if not share:
            raise HomeAssistantError(
                "No screensaver is waiting. Set one on a television opened from Home Assistant, then try again within the hour."
            )
        params["offer"] = "screensaver"
        params["pair"] = share["pair"]
    await hass.services.async_call(
        "webostv",
        "command",
        {
            "entity_id": entity_id,
            "command": "system.launcher/launch",
            "payload": {"id": APP_ID, "params": params},
        },
        blocking=True,
    )


def _notify(runtime: dict) -> None:
    for listener in list(runtime["listeners"]):
        listener()


async def _handle_webhook(hass: HomeAssistant, webhook_id: str, request: web.Request) -> web.Response:
    if webhook_id != WEBHOOK_ID:
        return web.Response(status=404, text="missing")
    entries = hass.config_entries.async_entries(DOMAIN)
    entry = entries[0] if entries else None
    runtime = hass.data.get(DOMAIN, {}).get(entry.entry_id) if entry else None
    if runtime is None or entry is None:
        return web.Response(status=404, text="missing")
    try:
        raw = await request.text()
        payload = json.loads(raw) if raw else {}
    except (json.JSONDecodeError, UnicodeError, ValueError):
        return web.Response(status=400, text="bad")
    if not isinstance(payload, dict):
        return web.Response(status=400, text="bad")
    pair = str(payload.get("pair") or "").strip().lower()
    if payload.get("screensaver") is not True or not PAIR_ID.fullmatch(pair):
        return web.Response(status=400, text="bad")
    runtime["share"] = {"pair": pair, "received": time.time()}
    _notify(runtime)
    hass.async_create_task(_offer_all(hass, entry))
    return web.Response(status=200, text="ok")


async def _offer_all(hass: HomeAssistant, entry) -> None:
    """Open the sync question on every chosen television."""
    for entity_id in tv_entities(entry):
        try:
            await async_launch(hass, entry, entity_id, True)
        except HomeAssistantError:
            continue


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register services once."""

    async def open_service(call: ServiceCall) -> None:
        entity_id = call.data[CONF_ENTITY_ID]
        await async_launch(hass, _entry_for(hass, entity_id), entity_id, False)

    async def offer_service(call: ServiceCall) -> None:
        entity_id = call.data[CONF_ENTITY_ID]
        await async_launch(hass, _entry_for(hass, entity_id), entity_id, True)

    hass.services.async_register(DOMAIN, "open", open_service, schema=OPEN_SCHEMA)
    hass.services.async_register(DOMAIN, "offer_sync", offer_service, schema=OFFER_SCHEMA)
    return True


async def _reload(hass: HomeAssistant, entry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_setup_entry(hass: HomeAssistant, entry) -> bool:
    """Set up one Lustre hub."""
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = {"share": None, "listeners": []}
    webhook.async_register(hass, DOMAIN, "Lustre", WEBHOOK_ID, _handle_webhook)
    entry.async_on_unload(lambda: webhook.async_unregister(hass, WEBHOOK_ID))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_reload))
    return True


async def async_unload_entry(hass: HomeAssistant, entry) -> bool:
    """Remove the hub."""
    unload = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return unload
