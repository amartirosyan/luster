"""Buttons that open Lustre on a television."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.helpers.device_registry import DeviceInfo

from .const import DOMAIN
from . import async_launch, tv_entities
from .sensor import _device


async def async_setup_entry(hass, entry, async_add_entities):
    """One open button and one offer button per television."""
    buttons = []
    for entity_id in tv_entities(entry):
        state = hass.states.get(entity_id)
        name = state.name if state else entity_id
        buttons.append(LustreButton(entry, entity_id, name, False))
        buttons.append(LustreButton(entry, entity_id, name, True))
    async_add_entities(buttons)


class LustreButton(ButtonEntity):
    """Open Lustre, or ask it to sync the screensaver."""

    _attr_has_entity_name = True

    def __init__(self, entry, entity_id: str, name: str, offer: bool) -> None:
        self._entry = entry
        self._tv = entity_id
        self._offer = offer
        slug = "offer" if offer else "open"
        self._attr_unique_id = f"{entry.entry_id}-{slug}-{entity_id}"
        self._attr_name = f"Offer screensaver to {name}" if offer else f"Open {name}"
        self._attr_icon = "mdi:television-play" if offer else "mdi:television"
        self._attr_device_info: DeviceInfo = _device(entry)

    async def async_press(self) -> None:
        await async_launch(self.hass, self._entry, self._tv, self._offer)
