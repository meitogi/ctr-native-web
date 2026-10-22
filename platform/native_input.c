#include <platform/native_input.h>

#include <macros.h>
#include "psx/libpad.h"

#include <SDL3/SDL.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#if defined(__EMSCRIPTEN__)
#include <emscripten.h>
#include <stddef.h>
#include <platform/native_web_ui.h>
#endif

#define NATIVE_INPUT_MAX_CONTROLLERS       PLATFORM_INPUT_PAD_COUNT
#define NATIVE_INPUT_PHYSICAL_SLOT_COUNT   2
#define NATIVE_INPUT_PAD_PACKET_BYTES      8
#define NATIVE_INPUT_MULTITAP_HEADER       2
#define NATIVE_INPUT_PAD_DIGITAL           0x41
#define NATIVE_INPUT_PAD_ANALOG            0x73
#define NATIVE_INPUT_PAD_MULTITAP          0x80
#define NATIVE_INPUT_PAD_DISCONNECT        0xff
#define NATIVE_INPUT_AXIS_DEADZONE         500
#define NATIVE_INPUT_MAP_FLAG_AXIS         0x4000
#define NATIVE_INPUT_MAP_FLAG_INVERSE      0x8000
#define NATIVE_INPUT_DEFAULT_KEYBOARD_SLOT 0
// NOTE(aalhendi): Little-endian tag `CTRI` = CTR native Input snapshot.
#define NATIVE_INPUT_STATE_MAGIC           0x49525443
#define NATIVE_INPUT_STATE_VERSION         1

// NOTE(aalhendi): Native input preserves behavior from PsyCross's
// MIT-licensed pad implementation while moving host ownership into ctr-native.
// See THIRD_PARTY_NOTICES.md.

struct NativeInputKeyboardMapping
{
	s32 id;

	s32 kc_square, kc_circle, kc_triangle, kc_cross;

	s32 kc_l1, kc_l2, kc_l3;
	s32 kc_r1, kc_r2, kc_r3;

	s32 kc_start, kc_select;

	s32 kc_dpad_left, kc_dpad_right, kc_dpad_up, kc_dpad_down;
};

struct NativeInputControllerMapping
{
	s32 id;

	s32 gc_square, gc_circle, gc_triangle, gc_cross;

	s32 gc_l1, gc_l2, gc_l3;
	s32 gc_r1, gc_r2, gc_r3;

	s32 gc_start, gc_select;

	s32 gc_dpad_left, gc_dpad_right, gc_dpad_up, gc_dpad_down;

	s32 gc_axis_left_x, gc_axis_left_y;
	s32 gc_axis_right_x, gc_axis_right_y;
};

struct NativeInputController
{
	SDL_JoystickID instanceId;
	SDL_Gamepad *controller;
	s32 analogEnabled;
	s32 switchingAnalog;
	struct PlatformInputPadSnapshot snapshot;
};

struct NativeInputControllerStateSnapshot
{
	struct PlatformInputPadSnapshot snapshot;
	s32 analogEnabled;
	s32 switchingAnalog;
	s32 controllerToSlotMapping;
};

struct NativeInputStateSnapshot
{
	u32 magic;
	u32 version;
	u32 size;
	s32 keyboardControllerSlot;
	s32 lastActiveControllerSlot;
	s32 installedSnapshotsActive;
	struct PlatformInputPadSnapshot installedSnapshots[NATIVE_INPUT_MAX_CONTROLLERS];
	struct NativeInputControllerStateSnapshot controllers[NATIVE_INPUT_MAX_CONTROLLERS];
};

global_variable struct NativeInputControllerMapping s_controllerMapping;
global_variable struct NativeInputKeyboardMapping s_keyboardMapping;
global_variable s32 s_controllerToSlotMapping[NATIVE_INPUT_MAX_CONTROLLERS] = {-1, -1, -1, -1};

global_variable struct NativeInputController s_controllers[NATIVE_INPUT_MAX_CONTROLLERS];
global_variable struct PlatformInputPadSnapshot s_installedSnapshots[NATIVE_INPUT_MAX_CONTROLLERS];
global_variable u8 *s_padSlotData[NATIVE_INPUT_PHYSICAL_SLOT_COUNT];
global_variable const bool *s_keyboardState;
global_variable s32 s_inputInitialized;
global_variable s32 s_installedSnapshotsActive;
global_variable s32 s_keyboardControllerSlot = NATIVE_INPUT_DEFAULT_KEYBOARD_SLOT;
global_variable s32 s_lastActiveControllerSlot = -1;

extern s32 g_padCommEnable;

internal u16 NativeInput_GetSnapshotButtons(const struct PlatformInputPadSnapshot *snapshot)
{
	return (u16)(snapshot->buttons[0] | (snapshot->buttons[1] << 8));
}

internal void NativeInput_SetSnapshotButtons(struct PlatformInputPadSnapshot *snapshot, u16 buttons)
{
	snapshot->buttons[0] = (u8)(buttons & 0xff);
	snapshot->buttons[1] = (u8)(buttons >> 8);
}

internal void NativeInput_ResetSnapshot(s32 slot)
{
	struct PlatformInputPadSnapshot *snapshot = &s_controllers[slot].snapshot;

	snapshot->connected = slot == 0;
	snapshot->status = snapshot->connected ? 0 : NATIVE_INPUT_PAD_DISCONNECT;
	snapshot->id = snapshot->connected ? NATIVE_INPUT_PAD_DIGITAL : NATIVE_INPUT_PAD_DISCONNECT;
	NativeInput_SetSnapshotButtons(snapshot, 0xffff);
	snapshot->analog[0] = 0x80;
	snapshot->analog[1] = 0x80;
	snapshot->analog[2] = 0x80;
	snapshot->analog[3] = 0x80;
	memset(snapshot->reserved, 0, sizeof(snapshot->reserved));
}

internal s32 NativeInput_IsValidControllerSlot(s32 slot)
{
	return (slot >= 0) && (slot < NATIVE_INPUT_MAX_CONTROLLERS);
}

internal s32 NativeInput_NextControllerSlot(s32 slot)
{
	slot++;
	if (slot >= NATIVE_INPUT_MAX_CONTROLLERS)
	{
		slot = 0;
	}

	return slot;
}

internal void NativeInput_MoveKeyboardOffControllerSlot(s32 slot)
{
	if (s_keyboardControllerSlot == slot)
	{
		s_keyboardControllerSlot = NativeInput_NextControllerSlot(s_keyboardControllerSlot);
	}
}

internal void NativeInput_MakeDisconnectedSnapshot(struct PlatformInputPadSnapshot *snapshot)
{
	if (snapshot == NULL)
	{
		return;
	}

	snapshot->connected = 0;
	snapshot->status = NATIVE_INPUT_PAD_DISCONNECT;
	snapshot->id = NATIVE_INPUT_PAD_DISCONNECT;
	NativeInput_SetSnapshotButtons(snapshot, 0xffff);
	snapshot->analog[0] = 0x80;
	snapshot->analog[1] = 0x80;
	snapshot->analog[2] = 0x80;
	snapshot->analog[3] = 0x80;
	memset(snapshot->reserved, 0, sizeof(snapshot->reserved));
}

internal void NativeInput_WritePadPacket(u8 *dst, const struct PlatformInputPadSnapshot *snapshot)
{
	if ((dst == NULL) || (snapshot == NULL))
	{
		return;
	}

	dst[0] = snapshot->status;
	dst[1] = snapshot->id;
	dst[2] = snapshot->buttons[0];
	dst[3] = snapshot->buttons[1];
	dst[4] = snapshot->analog[0];
	dst[5] = snapshot->analog[1];
	dst[6] = snapshot->analog[2];
	dst[7] = snapshot->analog[3];
}

internal s32 NativeInput_UseMultitapBus(void)
{
	for (s32 slot = NATIVE_INPUT_PHYSICAL_SLOT_COUNT; slot < NATIVE_INPUT_MAX_CONTROLLERS; slot++)
	{
		if (s_controllers[slot].snapshot.connected != 0)
		{
			return 1;
		}
	}

	return 0;
}

internal void NativeInput_WritePadBus(void)
{
	u8 *slot0 = s_padSlotData[0];
	u8 *slot1 = s_padSlotData[1];
	s32 useMultitap = NativeInput_UseMultitapBus();
	s32 slot;

	if (slot0 != NULL)
	{
		if (useMultitap != 0)
		{
			slot0[0] = 0;
			slot0[1] = NATIVE_INPUT_PAD_MULTITAP;
			for (slot = 0; slot < NATIVE_INPUT_MAX_CONTROLLERS; slot++)
			{
				NativeInput_WritePadPacket(&slot0[NATIVE_INPUT_MULTITAP_HEADER + (slot * NATIVE_INPUT_PAD_PACKET_BYTES)], &s_controllers[slot].snapshot);
			}
		}
		else
		{
			NativeInput_WritePadPacket(slot0, &s_controllers[0].snapshot);
		}
	}

	if (slot1 != NULL)
	{
		if (useMultitap != 0)
		{
			struct PlatformInputPadSnapshot disconnected;

			NativeInput_MakeDisconnectedSnapshot(&disconnected);
			NativeInput_WritePadPacket(slot1, &disconnected);
		}
		else
		{
			NativeInput_WritePadPacket(slot1, &s_controllers[1].snapshot);
		}
	}
}

internal void NativeInput_WriteInstalledSnapshots(void)
{
	for (s32 slot = 0; slot < NATIVE_INPUT_MAX_CONTROLLERS; slot++)
	{
		s_controllers[slot].snapshot = s_installedSnapshots[slot];
	}

	NativeInput_WritePadBus();
}

#if defined(__EMSCRIPTEN__)
// NOTE: Share mode (web/share/) drives P2–P4 from guests' pads. The page keeps
// each guest's latest pad ; once per input update the C side pulls them (JS
// never calls into the wasm : ASYNCIFY). Slots 1–3 only, after the SDL /
// keyboard pass : a guest's pad replaces whatever was in its slot, slot 0 stays
// the host's. Returns the mask of slots a guest holds (bit n = slot n) and
// writes their PSX pad packets (status, id, buttons, analog) at dst.
EM_JS(int, NativeInput_WebReadRemotePads, (u8 *dst), {
	const share = Module['ctrShare'];
	return share ? share.readPads(HEAPU8, dst) : 0;
});

internal void NativeInput_ApplyRemotePads(void)
{
	u8 packets[(NATIVE_INPUT_MAX_CONTROLLERS - 1) * NATIVE_INPUT_PAD_PACKET_BYTES];
	const s32 mask = NativeInput_WebReadRemotePads(packets);

	for (s32 slot = 1; slot < NATIVE_INPUT_MAX_CONTROLLERS; slot++)
	{
		struct PlatformInputPadSnapshot *snapshot = &s_controllers[slot].snapshot;
		const u8 *packet = &packets[(slot - 1) * NATIVE_INPUT_PAD_PACKET_BYTES];

		if ((mask & (1 << slot)) == 0)
		{
			continue;
		}

		snapshot->connected = 1;
		snapshot->status = packet[0];
		snapshot->id = packet[1];
		snapshot->buttons[0] = packet[2];
		snapshot->buttons[1] = packet[3];
		memcpy(snapshot->analog, &packet[4], sizeof(snapshot->analog));
	}

#if !defined(NDEBUG)
	{
		local_persist s32 s_loggedMask = 0;
		local_persist u16 s_loggedButtons[NATIVE_INPUT_MAX_CONTROLLERS] = {0xffff, 0xffff, 0xffff, 0xffff};

		for (s32 slot = 1; slot < NATIVE_INPUT_MAX_CONTROLLERS; slot++)
		{
			const s32 bit = 1 << slot;
			const u16 buttons = (mask & bit) ? NativeInput_GetSnapshotButtons(&s_controllers[slot].snapshot) : 0xffff;

			if ((mask & bit) != (s_loggedMask & bit))
			{
				printf("[CTR Web] remote pad slot=%d %s\n", slot, (mask & bit) ? "connected" : "disconnected");
			}
			if (buttons != s_loggedButtons[slot])
			{
				printf("[CTR Web] remote pad slot=%d buttons=0x%04x\n", slot, buttons);
				s_loggedButtons[slot] = buttons;
			}
		}
		s_loggedMask = mask;
	}
#endif
}
#endif

#if defined(__EMSCRIPTEN__)
// NOTE: the page's Settings panel (web/ui/, src/lib/input-hook.js) remaps the local keyboard and
// gamepads. Pulled by C once per input update, as Share's remote pads are (JS never calls into
// the wasm : ASYNCIFY) : the page writes 16 s32 per table in the structs' field order after `id`
// (kc_square … kc_dpad_down, gc_square … gc_dpad_down : SDL scancodes, SDL gamepad buttons or
// axis | MAP_FLAG_AXIS). Written every update (32 ints), so a re-init of the defaults cannot
// outlive the page's choice. Local input only : guests' pads (NativeInput_ApplyRemotePads) are
// not remapped here. No page hook = the defaults below, as on native.
// Couch mode (web/ui, Settings › Players) adds a second keyboard key set (keyboard2, same layout)
// and *duo : 1 while two players share the keyboard (s_keyboard2ControllerSlot, below).
// « Who plays » (Settings › Players) adds *device : 4 s32, mode (NATIVE_INPUT_WEB_DEVICE_*), then
// the chosen gamepad's USB vendor, product and rank among the pads with that pair (0 = any).
EM_JS(void, NativeInput_WebPullMappings, (s32 *keyboard, s32 *keyboard2, s32 *gamepad, s32 *duo, s32 *device), {
	const input = Module['ctrInput'];
	if (input) input.pull(HEAP32, keyboard >> 2, gamepad >> 2, keyboard2 >> 2, duo >> 2, device >> 2);
});

// include/platform/native_web_ui.h : 1 when the page saw a press for « Skip intro » (consumed).
EM_JS(int, NativeWeb_IntroSkip, (void), {
	const input = Module['ctrInput'];
	return input && input.introSkip() ? 1 : 0;
});

// 1 while the Settings panel is open : its keys and pad presses are not the game's.
EM_JS(int, NativeInput_WebLocalInputBlocked, (void), {
	const input = Module['ctrInput'];
	return input && input.blocked() ? 1 : 0;
});

_Static_assert(offsetof(struct NativeInputKeyboardMapping, kc_dpad_down) - offsetof(struct NativeInputKeyboardMapping, kc_square) == 15 * sizeof(s32),
	"the page writes the keyboard mapping as 16 contiguous s32");
_Static_assert(offsetof(struct NativeInputControllerMapping, gc_dpad_down) - offsetof(struct NativeInputControllerMapping, gc_square) == 15 * sizeof(s32),
	"the page writes the gamepad mapping as 16 contiguous s32");

// After the keyboard / SDL pass, before guests' pads : local pads stay plugged (unplugging
// pauses a race) with nothing held and sticks centred, the keyboard reads nothing.
internal void NativeInput_WebBlockLocalInput(void)
{
	if (!NativeInput_WebLocalInputBlocked())
	{
		return;
	}

	for (s32 slot = 0; slot < NATIVE_INPUT_MAX_CONTROLLERS; slot++)
	{
		struct PlatformInputPadSnapshot *snapshot = &s_controllers[slot].snapshot;

		NativeInput_SetSnapshotButtons(snapshot, 0xffff);
		memset(snapshot->analog, 0x80, sizeof(snapshot->analog));
	}
}

// Couch mode — the page's Settings › Players (web/ui/src/lib/players.js). The native build keeps
// one keyboard (F4 / F6 move it and the pads, CTR_INTERNAL builds) ; the web build adds :
//   - a second keyboard key set (s_keyboardMapping2) driving its own slot while the page says
//     two players share the keyboard ; it takes the first slot with no pad and no keyboard ;
//   - swap commands, pulled one at a time : (1 << 8) | (a << 4) | b swaps players a and b — their
//     pads and their keyboards — 0 = none ;
//   - a report of each slot (who drives it, the pad's name / vendor / product, analog or
//     digital, the buttons held before Settings blocks them) sent when it changes, so the page
//     shows P1–P4 and lights a row while its device is pressed.
#define NATIVE_INPUT_WEB_CMD_SWAP       1
#define NATIVE_INPUT_WEB_SLOT_CONNECTED 0x1
#define NATIVE_INPUT_WEB_SLOT_PAD       0x2
#define NATIVE_INPUT_WEB_SLOT_KEYBOARD  0x4
#define NATIVE_INPUT_WEB_SLOT_KEYBOARD2 0x8
#define NATIVE_INPUT_WEB_SLOT_ANALOG    0x10
#define NATIVE_INPUT_WEB_REPORT_INTS    6

global_variable struct NativeInputKeyboardMapping s_keyboardMapping2;
global_variable s32 s_keyboard2ControllerSlot = -1;
global_variable s32 s_webDuo;

// « Who plays » on this page — the page's choice, so one machine opening the game and Share's guest
// page can give the keyboard to one and a controller to the other (one controller seen by both
// windows drove two players at once). Auto : as native, every pad and the keyboard. Keyboard : no
// pad is opened, the keyboard is P1. Gamepad : only the chosen pad (else the first) is opened, as
// P1, and the keyboard drives no player. A change closes every local pad and reopens per the mode.
#define NATIVE_INPUT_WEB_DEVICE_AUTO     0
#define NATIVE_INPUT_WEB_DEVICE_KEYBOARD 1
#define NATIVE_INPUT_WEB_DEVICE_GAMEPAD  2
global_variable s32 s_webDevice[4];
global_variable s32 s_webDeviceApplied[4];

internal void NativeInput_CloseController(s32 slot);
internal void NativeInput_OpenKnownControllers(void);

// The pad « Gamepad » mode plays with : the chosen vendor / product at that rank, else the first.
internal SDL_JoystickID NativeInput_WebChosenPad(void)
{
	s32 count = 0;
	s32 rank = 0;
	SDL_JoystickID first = 0;
	SDL_JoystickID chosen = 0;
	SDL_JoystickID *gamepads = SDL_GetGamepads(&count);

	for (s32 i = 0; i < count; i++)
	{
		if (first == 0)
		{
			first = gamepads[i];
		}
		if ((chosen == 0) && (s_webDevice[1] != 0) && (SDL_GetGamepadVendorForID(gamepads[i]) == s_webDevice[1]) &&
		    (SDL_GetGamepadProductForID(gamepads[i]) == s_webDevice[2]) && (rank++ == s_webDevice[3]))
		{
			chosen = gamepads[i];
		}
	}
	SDL_free(gamepads);
	return chosen != 0 ? chosen : first;
}

internal s32 NativeInput_WebPadAllowed(SDL_JoystickID instanceId)
{
	if (s_webDevice[0] == NATIVE_INPUT_WEB_DEVICE_KEYBOARD)
	{
		return 0;
	}
	if (s_webDevice[0] == NATIVE_INPUT_WEB_DEVICE_GAMEPAD)
	{
		return instanceId == NativeInput_WebChosenPad();
	}

	return 1;
}

internal s32 NativeInput_WebKeyboardPlays(void)
{
	return s_webDevice[0] != NATIVE_INPUT_WEB_DEVICE_GAMEPAD;
}

internal void NativeInput_WebApplyDevice(void)
{
	if (memcmp(s_webDevice, s_webDeviceApplied, sizeof(s_webDevice)) == 0)
	{
		return;
	}

	memcpy(s_webDeviceApplied, s_webDevice, sizeof(s_webDevice));
	for (s32 slot = 0; slot < NATIVE_INPUT_MAX_CONTROLLERS; slot++)
	{
		NativeInput_CloseController(slot);
		s_controllerToSlotMapping[slot] = -1;
	}
	s_keyboardControllerSlot = NATIVE_INPUT_DEFAULT_KEYBOARD_SLOT;
	NativeInput_OpenKnownControllers();
}

// A pad came or went while « Gamepad » plays : the chosen one may have just arrived or left.
internal void NativeInput_WebDeviceHotplug(void)
{
	if (s_webDevice[0] == NATIVE_INPUT_WEB_DEVICE_GAMEPAD)
	{
		s_webDeviceApplied[0] = -1;
	}
}

EM_JS(int, NativeInput_WebPullPlayerCommand, (void), {
	const input = Module['ctrInput'];
	return input && input.players ? input.players.next() : 0;
});

// per slot : flags, buttons (PSX word, active low), SDL instance id, USB vendor, product, name
EM_JS(void, NativeInput_WebReportPlayersJS, (const s32 *slots, int count), {
	const input = Module['ctrInput'];
	if (!input || !input.players) return;
	const list = [];
	for (let i = 0; i < count; i++) {
		const at = (slots >> 2) + i * 6;
		list.push({ flags: HEAP32[at], buttons: HEAP32[at + 1] & 0xffff, instance: HEAP32[at + 2], vendor: HEAP32[at + 3],
			product: HEAP32[at + 4], name: HEAP32[at + 5] ? UTF8ToString(HEAP32[at + 5]) : "" });
	}
	input.players.report(list);
});

// The first slot with no pad and neither keyboard, else -1.
internal s32 NativeInput_WebFreeSlot(void)
{
	for (s32 slot = 0; slot < NATIVE_INPUT_MAX_CONTROLLERS; slot++)
	{
		if ((s_controllers[slot].controller == NULL) && (slot != s_keyboardControllerSlot) && (slot != s_keyboard2ControllerSlot))
		{
			return slot;
		}
	}

	return -1;
}

// The second keyboard follows the page's choice ; when a pad or the first keyboard lands on its
// slot it moves to a free one (or waits off until one frees).
internal void NativeInput_WebPlaceKeyboard2(void)
{
	if (s_webDuo == 0)
	{
		s_keyboard2ControllerSlot = -1;
		return;
	}

	if ((s_keyboard2ControllerSlot >= 0) && (s_controllers[s_keyboard2ControllerSlot].controller == NULL) &&
	    (s_keyboard2ControllerSlot != s_keyboardControllerSlot))
	{
		return;
	}

	s_keyboard2ControllerSlot = -1;
	s_keyboard2ControllerSlot = NativeInput_WebFreeSlot();
}

internal s32 NativeInput_SwapSlotValue(s32 value, s32 slotA, s32 slotB)
{
	if (value == slotA)
	{
		return slotB;
	}
	if (value == slotB)
	{
		return slotA;
	}

	return value;
}

internal void NativeInput_SwapControllerSlots(s32 slotA, s32 slotB);

internal void NativeInput_WebApplyPlayerCommands(void)
{
	for (s32 n = 0; n < 8; n++)
	{
		const s32 command = NativeInput_WebPullPlayerCommand();
		const s32 slotA = (command >> 4) & 0xf;
		const s32 slotB = command & 0xf;

		if (command == 0)
		{
			return;
		}
		if (((command >> 8) != NATIVE_INPUT_WEB_CMD_SWAP) || !NativeInput_IsValidControllerSlot(slotA) || !NativeInput_IsValidControllerSlot(slotB))
		{
			continue;
		}

		NativeInput_SwapControllerSlots(slotA, slotB);
		s_keyboardControllerSlot = NativeInput_SwapSlotValue(s_keyboardControllerSlot, slotA, slotB);
		s_keyboard2ControllerSlot = NativeInput_SwapSlotValue(s_keyboard2ControllerSlot, slotA, slotB);
	}
}

internal void NativeInput_WebReportPlayers(void)
{
	local_persist s32 s_reported[NATIVE_INPUT_MAX_CONTROLLERS * NATIVE_INPUT_WEB_REPORT_INTS];
	local_persist s32 s_reportedOnce;
	s32 slots[NATIVE_INPUT_MAX_CONTROLLERS * NATIVE_INPUT_WEB_REPORT_INTS];

	memset(slots, 0, sizeof(slots));
	for (s32 slot = 0; slot < NATIVE_INPUT_MAX_CONTROLLERS; slot++)
	{
		const struct NativeInputController *controller = &s_controllers[slot];
		s32 *out = &slots[slot * NATIVE_INPUT_WEB_REPORT_INTS];
		s32 flags = 0;

		if (controller->snapshot.connected != 0)
		{
			flags |= NATIVE_INPUT_WEB_SLOT_CONNECTED;
		}
		if (controller->controller != NULL)
		{
			SDL_Joystick *joystick = SDL_GetGamepadJoystick(controller->controller);

			flags |= NATIVE_INPUT_WEB_SLOT_PAD;
			if (controller->analogEnabled != 0)
			{
				flags |= NATIVE_INPUT_WEB_SLOT_ANALOG;
			}
			out[2] = (s32)controller->instanceId;
			out[3] = SDL_GetGamepadVendor(controller->controller);
			out[4] = SDL_GetGamepadProduct(controller->controller);
			out[5] = (s32)(size_t)(joystick != NULL ? SDL_GetJoystickName(joystick) : SDL_GetGamepadName(controller->controller));
		}
		if ((slot == s_keyboardControllerSlot) && NativeInput_WebKeyboardPlays())
		{
			flags |= NATIVE_INPUT_WEB_SLOT_KEYBOARD;
		}
		if ((slot == s_keyboard2ControllerSlot) && NativeInput_WebKeyboardPlays())
		{
			flags |= NATIVE_INPUT_WEB_SLOT_KEYBOARD2;
		}
		out[0] = flags;
		out[1] = NativeInput_GetSnapshotButtons(&controller->snapshot);
	}

	if (s_reportedOnce && (memcmp(slots, s_reported, sizeof(slots)) == 0))
	{
		return;
	}

	memcpy(s_reported, slots, sizeof(slots));
	s_reportedOnce = 1;
	NativeInput_WebReportPlayersJS(slots, NATIVE_INPUT_MAX_CONTROLLERS);
}
#endif

internal void NativeInput_DefaultMappings(void)
{
	s_keyboardMapping.kc_square = SDL_SCANCODE_X;
	s_keyboardMapping.kc_circle = SDL_SCANCODE_V;
	s_keyboardMapping.kc_triangle = SDL_SCANCODE_Z;
	s_keyboardMapping.kc_cross = SDL_SCANCODE_C;

	s_keyboardMapping.kc_l1 = SDL_SCANCODE_LSHIFT;
	s_keyboardMapping.kc_l2 = SDL_SCANCODE_LCTRL;
	s_keyboardMapping.kc_l3 = SDL_SCANCODE_LEFTBRACKET;

	s_keyboardMapping.kc_r1 = SDL_SCANCODE_RSHIFT;
	s_keyboardMapping.kc_r2 = SDL_SCANCODE_RCTRL;
	s_keyboardMapping.kc_r3 = SDL_SCANCODE_RIGHTBRACKET;

	s_keyboardMapping.kc_dpad_up = SDL_SCANCODE_UP;
	s_keyboardMapping.kc_dpad_down = SDL_SCANCODE_DOWN;
	s_keyboardMapping.kc_dpad_left = SDL_SCANCODE_LEFT;
	s_keyboardMapping.kc_dpad_right = SDL_SCANCODE_RIGHT;

	s_keyboardMapping.kc_select = SDL_SCANCODE_SPACE;
	s_keyboardMapping.kc_start = SDL_SCANCODE_RETURN;

	s_controllerMapping.gc_square = SDL_GAMEPAD_BUTTON_WEST;
	s_controllerMapping.gc_circle = SDL_GAMEPAD_BUTTON_EAST;
	s_controllerMapping.gc_triangle = SDL_GAMEPAD_BUTTON_NORTH;
	s_controllerMapping.gc_cross = SDL_GAMEPAD_BUTTON_SOUTH;

	s_controllerMapping.gc_l1 = SDL_GAMEPAD_BUTTON_LEFT_SHOULDER;
	s_controllerMapping.gc_l2 = SDL_GAMEPAD_AXIS_LEFT_TRIGGER | NATIVE_INPUT_MAP_FLAG_AXIS;
	s_controllerMapping.gc_l3 = SDL_GAMEPAD_BUTTON_LEFT_STICK;

	s_controllerMapping.gc_r1 = SDL_GAMEPAD_BUTTON_RIGHT_SHOULDER;
	s_controllerMapping.gc_r2 = SDL_GAMEPAD_AXIS_RIGHT_TRIGGER | NATIVE_INPUT_MAP_FLAG_AXIS;
	s_controllerMapping.gc_r3 = SDL_GAMEPAD_BUTTON_RIGHT_STICK;

	s_controllerMapping.gc_dpad_up = SDL_GAMEPAD_BUTTON_DPAD_UP;
	s_controllerMapping.gc_dpad_down = SDL_GAMEPAD_BUTTON_DPAD_DOWN;
	s_controllerMapping.gc_dpad_left = SDL_GAMEPAD_BUTTON_DPAD_LEFT;
	s_controllerMapping.gc_dpad_right = SDL_GAMEPAD_BUTTON_DPAD_RIGHT;

	s_controllerMapping.gc_select = SDL_GAMEPAD_BUTTON_BACK;
	s_controllerMapping.gc_start = SDL_GAMEPAD_BUTTON_START;

	s_controllerMapping.gc_axis_left_x = SDL_GAMEPAD_AXIS_LEFTX | NATIVE_INPUT_MAP_FLAG_AXIS;
	s_controllerMapping.gc_axis_left_y = SDL_GAMEPAD_AXIS_LEFTY | NATIVE_INPUT_MAP_FLAG_AXIS;
	s_controllerMapping.gc_axis_right_x = SDL_GAMEPAD_AXIS_RIGHTX | NATIVE_INPUT_MAP_FLAG_AXIS;
	s_controllerMapping.gc_axis_right_y = SDL_GAMEPAD_AXIS_RIGHTY | NATIVE_INPUT_MAP_FLAG_AXIS;
}

internal s32 NativeInput_ControllerButtonState(SDL_Gamepad *controller, s32 buttonOrAxis)
{
	if (controller == NULL)
	{
		return 0;
	}

	if ((buttonOrAxis & NATIVE_INPUT_MAP_FLAG_AXIS) != 0)
	{
		s32 axis = buttonOrAxis & ~(NATIVE_INPUT_MAP_FLAG_AXIS | NATIVE_INPUT_MAP_FLAG_INVERSE);
		s32 value = SDL_GetGamepadAxis(controller, (SDL_GamepadAxis)axis);

		if ((abs(value) > NATIVE_INPUT_AXIS_DEADZONE) && ((buttonOrAxis & NATIVE_INPUT_MAP_FLAG_INVERSE) != 0))
		{
			value *= -1;
		}

		return value;
	}

	if (buttonOrAxis < 0)
	{
		return 0;
	}

	return SDL_GetGamepadButton(controller, (SDL_GamepadButton)buttonOrAxis) * 32767;
}

internal u8 NativeInput_AxisToByte(s32 axis)
{
	s32 value = (axis / 256) + 128;

	if (value < 0)
	{
		return 0;
	}

	if (value > 0xff)
	{
		return 0xff;
	}

	return (u8)value;
}

internal s32 NativeInput_AxisIsActive(s32 axis)
{
	return abs(axis) > NATIVE_INPUT_AXIS_DEADZONE;
}

internal void NativeInput_ApplyController(s32 slot)
{
	struct NativeInputController *nativeController = &s_controllers[slot];
	struct PlatformInputPadSnapshot *snapshot = &nativeController->snapshot;
	const struct NativeInputControllerMapping *mapping = &s_controllerMapping;
	SDL_Gamepad *controller = nativeController->controller;
	u16 buttons = 0xffff;

	if ((controller == NULL) || (SDL_GamepadConnected(controller) == 0))
	{
		return;
	}

	snapshot->connected = 1;
	snapshot->status = 0;
	snapshot->id = nativeController->analogEnabled ? NATIVE_INPUT_PAD_ANALOG : NATIVE_INPUT_PAD_DIGITAL;

	if (NativeInput_ControllerButtonState(controller, mapping->gc_square) > 16384)
	{
		buttons &= ~0x8000;
	}
	if (NativeInput_ControllerButtonState(controller, mapping->gc_circle) > 16384)
	{
		buttons &= ~0x2000;
	}
	if (NativeInput_ControllerButtonState(controller, mapping->gc_triangle) > 16384)
	{
		buttons &= ~0x1000;
	}
	if (NativeInput_ControllerButtonState(controller, mapping->gc_cross) > 16384)
	{
		buttons &= ~0x4000;
	}
	if (NativeInput_ControllerButtonState(controller, mapping->gc_l1) > 16384)
	{
		buttons &= ~0x400;
	}
	if (NativeInput_ControllerButtonState(controller, mapping->gc_r1) > 16384)
	{
		buttons &= ~0x800;
	}
	if (NativeInput_ControllerButtonState(controller, mapping->gc_l2) > 16384)
	{
		buttons &= ~0x100;
	}
	if (NativeInput_ControllerButtonState(controller, mapping->gc_r2) > 16384)
	{
		buttons &= ~0x200;
	}
	if (NativeInput_ControllerButtonState(controller, mapping->gc_dpad_up) > 16384)
	{
		buttons &= ~0x10;
	}
	if (NativeInput_ControllerButtonState(controller, mapping->gc_dpad_down) > 16384)
	{
		buttons &= ~0x40;
	}
	if (NativeInput_ControllerButtonState(controller, mapping->gc_dpad_left) > 16384)
	{
		buttons &= ~0x80;
	}
	if (NativeInput_ControllerButtonState(controller, mapping->gc_dpad_right) > 16384)
	{
		buttons &= ~0x20;
	}
	if (NativeInput_ControllerButtonState(controller, mapping->gc_l3) > 16384)
	{
		buttons &= ~0x2;
	}
	if (NativeInput_ControllerButtonState(controller, mapping->gc_r3) > 16384)
	{
		buttons &= ~0x4;
	}
	if (NativeInput_ControllerButtonState(controller, mapping->gc_select) > 16384)
	{
		buttons &= ~0x1;
	}
	if (NativeInput_ControllerButtonState(controller, mapping->gc_start) > 16384)
	{
		buttons &= ~0x8;
	}

	s32 rightX = NativeInput_ControllerButtonState(controller, mapping->gc_axis_right_x);
	s32 rightY = NativeInput_ControllerButtonState(controller, mapping->gc_axis_right_y);
	s32 leftX = NativeInput_ControllerButtonState(controller, mapping->gc_axis_left_x);
	s32 leftY = NativeInput_ControllerButtonState(controller, mapping->gc_axis_left_y);

	if ((buttons != 0xffff) || NativeInput_AxisIsActive(rightX) || NativeInput_AxisIsActive(rightY) || NativeInput_AxisIsActive(leftX) ||
	    NativeInput_AxisIsActive(leftY))
	{
		s_lastActiveControllerSlot = slot;
	}

	if (((buttons & 0x1) == 0) && ((buttons & 0x8) == 0))
	{
		buttons = 0xffff;
		if (nativeController->switchingAnalog == 0)
		{
			nativeController->analogEnabled = nativeController->analogEnabled == 0;
		}
		nativeController->switchingAnalog = 1;
	}
	else
	{
		nativeController->switchingAnalog = 0;
	}

	NativeInput_SetSnapshotButtons(snapshot, buttons);
	snapshot->analog[0] = NativeInput_AxisToByte(rightX);
	snapshot->analog[1] = NativeInput_AxisToByte(rightY);
	snapshot->analog[2] = NativeInput_AxisToByte(leftX);
	snapshot->analog[3] = NativeInput_AxisToByte(leftY);
}

internal u16 NativeInput_ReadKeyboardMapping(const struct NativeInputKeyboardMapping *mapping)
{
	u16 buttons = 0xffff;

	if (s_keyboardState == NULL)
	{
		return buttons;
	}

	if (s_keyboardState[mapping->kc_square])
	{
		buttons &= ~0x8000;
	}
	if (s_keyboardState[mapping->kc_circle])
	{
		buttons &= ~0x2000;
	}
	if (s_keyboardState[mapping->kc_triangle])
	{
		buttons &= ~0x1000;
	}
	if (s_keyboardState[mapping->kc_cross])
	{
		buttons &= ~0x4000;
	}
	if (s_keyboardState[mapping->kc_l1])
	{
		buttons &= ~0x400;
	}
	if (s_keyboardState[mapping->kc_l2])
	{
		buttons &= ~0x100;
	}
	if (s_keyboardState[mapping->kc_l3])
	{
		buttons &= ~0x2;
	}
	if (s_keyboardState[mapping->kc_r1])
	{
		buttons &= ~0x800;
	}
	if (s_keyboardState[mapping->kc_r2])
	{
		buttons &= ~0x200;
	}
	if (s_keyboardState[mapping->kc_r3])
	{
		buttons &= ~0x4;
	}
	if (s_keyboardState[mapping->kc_dpad_up])
	{
		buttons &= ~0x10;
	}
	if (s_keyboardState[mapping->kc_dpad_down])
	{
		buttons &= ~0x40;
	}
	if (s_keyboardState[mapping->kc_dpad_left])
	{
		buttons &= ~0x80;
	}
	if (s_keyboardState[mapping->kc_dpad_right])
	{
		buttons &= ~0x20;
	}
	if (s_keyboardState[mapping->kc_select])
	{
		buttons &= ~0x1;
	}
	if (s_keyboardState[mapping->kc_start])
	{
		buttons &= ~0x8;
	}

	return buttons;
}

internal u16 NativeInput_ReadKeyboard(void)
{
	return NativeInput_ReadKeyboardMapping(&s_keyboardMapping);
}

internal s32 NativeInput_KeyboardSuppressed(void)
{
	if (s_keyboardState == NULL)
	{
		return 0;
	}

	return s_keyboardState[SDL_SCANCODE_RALT] || s_keyboardState[SDL_SCANCODE_LALT];
}

internal void NativeInput_ApplyKeyboardTo(s32 slot, s32 keyboardSlot, u16 keyboardButtons)
{
	struct PlatformInputPadSnapshot *snapshot = &s_controllers[slot].snapshot;

	if (slot != keyboardSlot)
	{
		return;
	}

	if (snapshot->connected == 0)
	{
		snapshot->connected = 1;
		snapshot->status = 0;
		snapshot->id = NATIVE_INPUT_PAD_DIGITAL;
	}

	u16 buttons = NativeInput_GetSnapshotButtons(snapshot);
	NativeInput_SetSnapshotButtons(snapshot, buttons & keyboardButtons);
}

internal void NativeInput_ApplyKeyboard(s32 slot, u16 keyboardButtons)
{
	NativeInput_ApplyKeyboardTo(slot, s_keyboardControllerSlot, keyboardButtons);
}

internal s32 NativeInput_FindActiveControllerSlot(void)
{
	if (NativeInput_IsValidControllerSlot(s_lastActiveControllerSlot) && (s_controllers[s_lastActiveControllerSlot].controller != NULL))
	{
		return s_lastActiveControllerSlot;
	}

	for (s32 slot = 0; slot < NATIVE_INPUT_MAX_CONTROLLERS; slot++)
	{
		if (s_controllers[slot].controller != NULL)
		{
			return slot;
		}
	}

	return -1;
}

internal void NativeInput_SwapControllerSlots(s32 slotA, s32 slotB)
{
	if (!NativeInput_IsValidControllerSlot(slotA) || !NativeInput_IsValidControllerSlot(slotB) || (slotA == slotB))
	{
		return;
	}

	struct NativeInputController controller = s_controllers[slotA];
	s_controllers[slotA] = s_controllers[slotB];
	s_controllers[slotB] = controller;

	s32 mapping = s_controllerToSlotMapping[slotA];
	s_controllerToSlotMapping[slotA] = s_controllerToSlotMapping[slotB];
	s_controllerToSlotMapping[slotB] = mapping;

	if (s_lastActiveControllerSlot == slotA)
	{
		s_lastActiveControllerSlot = slotB;
	}
	else if (s_lastActiveControllerSlot == slotB)
	{
		s_lastActiveControllerSlot = slotA;
	}
}

internal s32 NativeInput_FindSlotForDeviceIndex(Sint32 deviceIndex)
{
	s32 slot;

	for (slot = 0; slot < NATIVE_INPUT_MAX_CONTROLLERS; slot++)
	{
		if (s_controllerToSlotMapping[slot] == deviceIndex)
		{
			return slot;
		}
	}

	for (slot = 0; slot < NATIVE_INPUT_MAX_CONTROLLERS; slot++)
	{
		if ((s_controllerToSlotMapping[slot] < 0) && (s_controllers[slot].controller == NULL))
		{
			return slot;
		}
	}

	return -1;
}

internal void NativeInput_CloseController(s32 slot)
{
	if ((slot < 0) || (slot >= NATIVE_INPUT_MAX_CONTROLLERS))
	{
		return;
	}

	struct NativeInputController *controller = &s_controllers[slot];
	if (controller->controller != NULL)
	{
		SDL_CloseGamepad(controller->controller);
	}

	controller->controller = NULL;
	controller->instanceId = -1;
	controller->analogEnabled = 0;
	controller->switchingAnalog = 0;

	if (s_lastActiveControllerSlot == slot)
	{
		s_lastActiveControllerSlot = -1;
	}
}

internal void NativeInput_OpenController(SDL_JoystickID instanceId, s32 slot)
{
	if ((slot < 0) || (slot >= NATIVE_INPUT_MAX_CONTROLLERS))
	{
		return;
	}

	if (SDL_IsGamepad(instanceId) == 0)
	{
		return;
	}

	struct NativeInputController *controller = &s_controllers[slot];
	if (controller->controller != NULL)
	{
		return;
	}
#if defined(__EMSCRIPTEN__)
	if (!NativeInput_WebPadAllowed(instanceId))
	{
		return;
	}
#endif

	controller->controller = SDL_OpenGamepad(instanceId);
	if (controller->controller == NULL)
	{
		return;
	}

	SDL_Joystick *joystick = SDL_GetGamepadJoystick(controller->controller);
	controller->instanceId = joystick != NULL ? SDL_GetJoystickID(joystick) : instanceId;
	controller->analogEnabled = 1;
	controller->switchingAnalog = 0;
	NativeInput_MoveKeyboardOffControllerSlot(slot);
#if defined(__EMSCRIPTEN__) && !defined(NDEBUG)
	printf("[CTR Web] gamepad added: slot=%d name=%s\n", slot, SDL_GetGamepadName(controller->controller));
#endif
}

internal void NativeInput_OpenKnownControllers(void)
{
	s32 count = 0;

	SDL_JoystickID *gamepads = SDL_GetGamepads(&count);
	for (s32 i = 0; i < count; i++)
	{
		s32 slot = NativeInput_FindSlotForDeviceIndex(gamepads[i]);

		if (slot >= 0)
		{
			NativeInput_OpenController(gamepads[i], slot);
		}
	}
	SDL_free(gamepads);
}

int Platform_InputInit(void)
{
	if (s_inputInitialized != 0)
	{
		return 1;
	}

	memset(s_controllers, 0, sizeof(s_controllers));
	memset(s_padSlotData, 0, sizeof(s_padSlotData));
	for (s32 slot = 0; slot < NATIVE_INPUT_MAX_CONTROLLERS; slot++)
	{
		s_controllers[slot].instanceId = -1;
		NativeInput_ResetSnapshot(slot);
		s_installedSnapshots[slot] = s_controllers[slot].snapshot;
	}

	NativeInput_DefaultMappings();
	s_keyboardControllerSlot = NATIVE_INPUT_DEFAULT_KEYBOARD_SLOT;
	s_lastActiveControllerSlot = -1;
	s_installedSnapshotsActive = 0;
	s_keyboardState = SDL_GetKeyboardState(NULL);

	if (SDL_InitSubSystem(SDL_INIT_GAMEPAD | SDL_INIT_HAPTIC) == 0)
	{
		fprintf(stderr, "[CTR Native] Failed to initialise SDL input subsystem: %s\n", SDL_GetError());
		return 0;
	}

	SDL_AddGamepadMappingsFromFile("gamecontrollerdb.txt");
	NativeInput_OpenKnownControllers();

	s_inputInitialized = 1;
	return 1;
}

void Platform_InputShutdown(void)
{
	for (s32 slot = 0; slot < NATIVE_INPUT_MAX_CONTROLLERS; slot++)
	{
		NativeInput_CloseController(slot);
	}

	if (s_inputInitialized != 0)
	{
		SDL_QuitSubSystem(SDL_INIT_GAMEPAD | SDL_INIT_HAPTIC);
	}

	s_inputInitialized = 0;
	s_installedSnapshotsActive = 0;
	s_keyboardControllerSlot = NATIVE_INPUT_DEFAULT_KEYBOARD_SLOT;
	s_lastActiveControllerSlot = -1;
	memset(s_padSlotData, 0, sizeof(s_padSlotData));
	s_keyboardState = NULL;
}

void Platform_InputUpdate(void)
{
	if (s_inputInitialized == 0)
	{
		return;
	}

	if (s_installedSnapshotsActive != 0)
	{
		// NOTE(aalhendi): replay/state installs PSX-shaped pad bytes here;
		// SDL host state is not serialized.
		NativeInput_WriteInstalledSnapshots();
		return;
	}

	if (g_padCommEnable == 0)
	{
		return;
	}

	SDL_PumpEvents();
#if defined(__EMSCRIPTEN__)
	NativeInput_WebPullMappings(&s_keyboardMapping.kc_square, &s_keyboardMapping2.kc_square, &s_controllerMapping.gc_square, &s_webDuo, s_webDevice);
	NativeInput_WebApplyDevice();
	NativeInput_WebApplyPlayerCommands();
	NativeInput_WebPlaceKeyboard2();
	u16 keyboard2Buttons = (NativeInput_KeyboardSuppressed() || (s_keyboard2ControllerSlot < 0)) ? 0xffff : NativeInput_ReadKeyboardMapping(&s_keyboardMapping2);
	const s32 keyboardPlays = NativeInput_WebKeyboardPlays();
#endif
	u16 keyboardButtons = NativeInput_KeyboardSuppressed() ? 0xffff : NativeInput_ReadKeyboard();

	for (s32 slot = 0; slot < NATIVE_INPUT_MAX_CONTROLLERS; slot++)
	{
		NativeInput_ResetSnapshot(slot);
		NativeInput_ApplyController(slot);
#if defined(__EMSCRIPTEN__)
		if (keyboardPlays)
		{
			NativeInput_ApplyKeyboard(slot, keyboardButtons);
			NativeInput_ApplyKeyboardTo(slot, s_keyboard2ControllerSlot, keyboard2Buttons);
		}
#else
		NativeInput_ApplyKeyboard(slot, keyboardButtons);
#endif
	}
#if defined(__EMSCRIPTEN__)
	NativeInput_WebReportPlayers();
	NativeInput_WebBlockLocalInput();
	NativeInput_ApplyRemotePads();
#endif
	NativeInput_WritePadBus();

#if defined(__EMSCRIPTEN__) && !defined(NDEBUG)
	// NOTE: debug web builds log pad 0's PSX button word (active low) when it
	// changes, so the browser suites can assert that keyboard and gamepad
	// input reach the pad bus.
	{
		local_persist u16 s_loggedButtons = 0xffff;
		const struct PlatformInputPadSnapshot *pad0 = &s_controllers[0].snapshot;
		const u16 buttons = (u16)(pad0->buttons[0] | (pad0->buttons[1] << 8));

		if (buttons != s_loggedButtons)
		{
			printf("[CTR Web] pad0 buttons=0x%04x\n", buttons);
			s_loggedButtons = buttons;
		}
	}
#endif
}

void Platform_InputControllerAdded(int deviceIndex)
{
	if (s_inputInitialized == 0)
	{
		return;
	}
#if defined(__EMSCRIPTEN__)
	// SDL also sends GAMEPAD_ADDED for a pad Platform_InputInit already opened (one visible at
	// start-up : a button pressed while the page loaded) : without this it opens a second time in
	// the next free slot, one pad driving P1 and P2, and its removal closes only the first.
	for (s32 slot = 0; slot < NATIVE_INPUT_MAX_CONTROLLERS; slot++)
	{
		if ((s_controllers[slot].controller != NULL) && (s_controllers[slot].instanceId == (SDL_JoystickID)deviceIndex))
		{
			return;
		}
	}
	NativeInput_WebDeviceHotplug();
#endif

	s32 slot = NativeInput_FindSlotForDeviceIndex(deviceIndex);
	if (slot >= 0)
	{
		NativeInput_OpenController(deviceIndex, slot);
	}
}

void Platform_InputControllerRemoved(int instanceId)
{
#if defined(__EMSCRIPTEN__)
	NativeInput_WebDeviceHotplug();
#endif
	for (s32 slot = 0; slot < NATIVE_INPUT_MAX_CONTROLLERS; slot++)
	{
		if (s_controllers[slot].instanceId == (SDL_JoystickID)instanceId)
		{
			NativeInput_CloseController(slot);
			return;
		}
	}
}

int Platform_InputCycleKeyboardController(void)
{
	s_keyboardControllerSlot = NativeInput_NextControllerSlot(s_keyboardControllerSlot);
	return s_keyboardControllerSlot + 1;
}

int Platform_InputCycleGamepadController(void)
{
	s32 slot = NativeInput_FindActiveControllerSlot();

	if (slot < 0)
	{
		return 0;
	}

	s32 nextSlot = NativeInput_NextControllerSlot(slot);
	NativeInput_SwapControllerSlots(slot, nextSlot);
	NativeInput_WritePadBus();
	return nextSlot + 1;
}

void Platform_InputPadInit(int slot, unsigned char *padData)
{
	if ((slot < 0) || (slot >= NATIVE_INPUT_PHYSICAL_SLOT_COUNT))
	{
		return;
	}

	s_padSlotData[slot] = padData;
	NativeInput_WritePadBus();
}

int Platform_InputPadGetState(int port)
{
	s32 physicalSlot = (port >> 4) & 1;
	s32 tap = port & 3;
	s32 slot;

	if (NativeInput_UseMultitapBus() != 0)
	{
		if (physicalSlot != 0)
		{
			return PadStateDiscon;
		}
		slot = tap;
	}
	else
	{
		if (tap != 0)
		{
			return PadStateDiscon;
		}
		slot = physicalSlot;
	}

	if ((slot < 0) || (slot >= NATIVE_INPUT_MAX_CONTROLLERS))
	{
		return PadStateDiscon;
	}

	return s_controllers[slot].snapshot.connected ? PadStateStable : PadStateDiscon;
}

int Platform_InputCapturePadSnapshots(struct PlatformInputPadSnapshot *dst, int count)
{
	if ((dst == NULL) || (count < NATIVE_INPUT_MAX_CONTROLLERS))
	{
		return 0;
	}

	for (s32 slot = 0; slot < NATIVE_INPUT_MAX_CONTROLLERS; slot++)
	{
		dst[slot] = s_controllers[slot].snapshot;
	}

	return NATIVE_INPUT_MAX_CONTROLLERS;
}

int Platform_InputInstallPadSnapshots(const struct PlatformInputPadSnapshot *src, int count)
{
	if ((src == NULL) || (count < NATIVE_INPUT_MAX_CONTROLLERS))
	{
		return 0;
	}

	for (s32 slot = 0; slot < NATIVE_INPUT_MAX_CONTROLLERS; slot++)
	{
		s_installedSnapshots[slot] = src[slot];
	}

	s_installedSnapshotsActive = 1;
	NativeInput_WriteInstalledSnapshots();
	return NATIVE_INPUT_MAX_CONTROLLERS;
}

void Platform_InputClearInstalledPadSnapshots(void)
{
	s_installedSnapshotsActive = 0;
}

int Platform_InputGetStateSize(void)
{
	return (int)sizeof(struct NativeInputStateSnapshot);
}

int Platform_InputCaptureState(void *dst, int dstSize)
{
	struct NativeInputStateSnapshot *snapshot = (struct NativeInputStateSnapshot *)dst;

	if ((dst == NULL) || (dstSize < (int)sizeof(*snapshot)))
	{
		return 0;
	}

	memset(snapshot, 0, sizeof(*snapshot));
	snapshot->magic = NATIVE_INPUT_STATE_MAGIC;
	snapshot->version = NATIVE_INPUT_STATE_VERSION;
	snapshot->size = sizeof(*snapshot);
	snapshot->keyboardControllerSlot = s_keyboardControllerSlot;
	snapshot->lastActiveControllerSlot = s_lastActiveControllerSlot;
	snapshot->installedSnapshotsActive = s_installedSnapshotsActive;

	for (s32 slot = 0; slot < NATIVE_INPUT_MAX_CONTROLLERS; slot++)
	{
		snapshot->installedSnapshots[slot] = s_installedSnapshots[slot];
		snapshot->controllers[slot].snapshot = s_controllers[slot].snapshot;
		snapshot->controllers[slot].analogEnabled = s_controllers[slot].analogEnabled;
		snapshot->controllers[slot].switchingAnalog = s_controllers[slot].switchingAnalog;
		snapshot->controllers[slot].controllerToSlotMapping = s_controllerToSlotMapping[slot];
	}

	return 1;
}

int Platform_InputRestoreState(const void *src, int srcSize)
{
	const struct NativeInputStateSnapshot *snapshot = (const struct NativeInputStateSnapshot *)src;
	s32 slot;

	if ((src == NULL) || (srcSize < (int)sizeof(*snapshot)))
	{
		return 0;
	}
	if ((snapshot->magic != NATIVE_INPUT_STATE_MAGIC) || (snapshot->version != NATIVE_INPUT_STATE_VERSION) || (snapshot->size != sizeof(*snapshot)))
	{
		return 0;
	}
	if (!NativeInput_IsValidControllerSlot(snapshot->keyboardControllerSlot))
	{
		return 0;
	}
	if ((snapshot->lastActiveControllerSlot < -1) || (snapshot->lastActiveControllerSlot >= NATIVE_INPUT_MAX_CONTROLLERS))
	{
		return 0;
	}
	if ((snapshot->installedSnapshotsActive < 0) || (snapshot->installedSnapshotsActive > 1))
	{
		return 0;
	}
	for (slot = 0; slot < NATIVE_INPUT_MAX_CONTROLLERS; slot++)
	{
		if ((snapshot->controllers[slot].analogEnabled < 0) || (snapshot->controllers[slot].analogEnabled > 1))
		{
			return 0;
		}
		if ((snapshot->controllers[slot].switchingAnalog < 0) || (snapshot->controllers[slot].switchingAnalog > 1))
		{
			return 0;
		}
		if (snapshot->controllers[slot].controllerToSlotMapping < -1)
		{
			return 0;
		}
	}

	s_keyboardControllerSlot = snapshot->keyboardControllerSlot;
	s_lastActiveControllerSlot = snapshot->lastActiveControllerSlot;
	s_installedSnapshotsActive = snapshot->installedSnapshotsActive != 0;

	for (slot = 0; slot < NATIVE_INPUT_MAX_CONTROLLERS; slot++)
	{
		s_installedSnapshots[slot] = snapshot->installedSnapshots[slot];
		s_controllers[slot].snapshot = snapshot->controllers[slot].snapshot;
		s_controllers[slot].analogEnabled = snapshot->controllers[slot].analogEnabled;
		s_controllers[slot].switchingAnalog = snapshot->controllers[slot].switchingAnalog;
		s_controllerToSlotMapping[slot] = snapshot->controllers[slot].controllerToSlotMapping;
	}
	NativeInput_WritePadBus();

	return 1;
}

void Platform_InputPadVibrate(int port, unsigned char *table, int len)
{
	s32 physicalSlot = (port >> 4) & 1;
	s32 tap = port & 3;
	s32 slot;

	if (NativeInput_UseMultitapBus() != 0)
	{
		if (physicalSlot != 0)
		{
			return;
		}
		slot = tap;
	}
	else
	{
		if (tap != 0)
		{
			return;
		}
		slot = physicalSlot;
	}

	if ((slot < 0) || (slot >= NATIVE_INPUT_MAX_CONTROLLERS) || (table == NULL) || (len <= 0))
	{
		return;
	}

	struct NativeInputController *controller = &s_controllers[slot];
	if (controller->controller == NULL)
	{
		return;
	}

	u16 freqHigh = table[0] * 255;
	u16 freqLow = len > 1 ? table[1] * 255 : 0;

	if ((freqLow != 0) && (freqLow < 4096))
	{
		freqLow = 4096;
	}

	if ((freqHigh != 0) && (freqHigh < 4096))
	{
		freqHigh = 4096;
	}

	SDL_RumbleGamepad(controller->controller, freqLow, freqHigh, 200);
}
