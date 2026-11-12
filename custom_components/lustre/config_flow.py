"""Config flow for Lustre."""

from __future__ import annotations

from secrets import token_urlsafe

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.selector import selector

from .const import DOMAIN

TV_SELECTOR = selector(
    {
        "entity": {
            "multiple": True,
            "filter": {"integration": "webostv", "domain": "media_player"},
        }
    }
)


def _tvs(user_input: dict) -> list[str]:
    raw = user_input.get("tvs") or []
    if isinstance(raw, str):
        raw = [raw]
    return [entity for entity in raw if isinstance(entity, str)]


class LustreConfigFlow(ConfigFlow, domain=DOMAIN):
    """Set up Lustre once."""

    async def async_step_user(self, user_input=None):
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        errors = {}
        if user_input is not None:
            tvs = _tvs(user_input)
            if not tvs:
                errors["base"] = "tvs"
            else:
                return self.async_create_entry(
                    title="Lustre",
                    data={"webhook_id": token_urlsafe(24), "tvs": tvs},
                )
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({vol.Required("tvs"): TV_SELECTOR}),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry):
        return LustreOptionsFlow()


class LustreOptionsFlow(OptionsFlow):
    """Change which televisions Lustre opens."""

    async def async_step_init(self, user_input=None):
        errors = {}
        current = self.config_entry.options.get("tvs", self.config_entry.data.get("tvs") or [])
        if user_input is not None:
            tvs = _tvs(user_input)
            if not tvs:
                errors["base"] = "tvs"
            else:
                return self.async_create_entry(data={"tvs": tvs})
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema({vol.Required("tvs", default=current): TV_SELECTOR}),
            errors=errors,
        )
