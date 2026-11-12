"""Screensaver window sensor."""

from __future__ import annotations

import time

from homeassistant.components.sensor import SensorEntity
from homeassistant.helpers.device_registry import DeviceInfo

from .const import DOMAIN, SHARE_WINDOW
from . import current_share


def _device(entry) -> DeviceInfo:
    return DeviceInfo(
        identifiers={(DOMAIN, entry.entry_id)},
        name="Lustre",
        manufacturer="Lustre",
        model="Screensaver",
    )


async def async_setup_entry(hass, entry, async_add_entities):
    """Create the screensaver status."""
    async_add_entities([LustreShareSensor(hass, entry)])


class LustreShareSensor(SensorEntity):
    """Reports whether a screensaver can still be offered."""

    _attr_has_entity_name = True
    _attr_name = "Screensaver"
    _attr_icon = "mdi:image-multiple"

    def __init__(self, hass, entry) -> None:
        self.hass = hass
        self._entry = entry
        self._attr_unique_id = f"{entry.entry_id}-screensaver"
        self._attr_device_info = _device(entry)

    async def async_added_to_hass(self) -> None:
        runtime = self.hass.data[DOMAIN][self._entry.entry_id]

        def _update() -> None:
            self.schedule_update_ha_state()

        runtime["listeners"].append(_update)
        self.async_on_remove(lambda: runtime["listeners"].remove(_update))

    @property
    def native_value(self) -> str:
        runtime = self.hass.data[DOMAIN][self._entry.entry_id]
        share = runtime.get("share")
        if not share:
            return "none"
        if current_share(runtime) is None:
            return "expired"
        return "ready"

    @property
    def extra_state_attributes(self) -> dict:
        runtime = self.hass.data[DOMAIN][self._entry.entry_id]
        share = current_share(runtime)
        if not share:
            return {}
        left = max(0, SHARE_WINDOW - (time.time() - share["received"]))
        return {"minutes_left": int(left // 60)}
