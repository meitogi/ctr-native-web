# OnlineCTR port — audit and integration decisions

How OnlineCTR (the online multiplayer mod of CTR-ModSDK) is brought into
CTR Native Web: what it is made of, what it touches in the game, where each
piece goes once there is no emulator, and what is checked first.

## Summary

- **ctr-native already carried OnlineCTR, then removed it.** On 2026-05-18,
  commit `930ca3f79` ("remove all USE_ONLINE conditional blocks from game
  source", 61 files, −863 lines) and commit `82e743de9` ("remove all AltMods
  includes", which deleted `game/AltMods/OnlineCTR/`) took it out of this
  tree. Those two diffs are the exact list of what OnlineCTR changes in the
  game, already expressed in ctr-native's own decompile. They cover
  **about 60 functions plus `struct Driver`, `struct Data` and
  `include/common.h`, in 61 files**, plus the mod's 14 files.
- Since then, the game sources were renamed and merged. `DECOMP_` prefixes
  were dropped, numbered files were folded into bigger ones (`game/PROC.c`,
  `game/MAIN/MainInit.c`, `game/GAMEPAD.c`, …), and some signatures changed.
  The integration therefore re-applies a known diff onto moved code; there
  are no hooks to discover. The [mapping table](#game-functions-touched-by-onlinectr)
  gives the current location of every block.
- The in-game mod never sees the network. It reads and writes one 1 KB shared
  struct, `octr`. A separate PC program (`CL_main.cpp`) reads the emulator's
  RAM, speaks the protocol over ENet and writes back into `octr` and into
  game memory. In this port, that program becomes an in-process C module
  between `octr` and a transport interface.
- The server is a relay with per-room state: 16 rooms × 8 players, no game
  logic. Its logic is split into a transport-agnostic C core. The core runs
  natively behind ENet (for testing against the original) and inside the
  host's wasm in the browser.
- Wire compatibility with public servers is kept by construction: the
  message structs of upstream `global.h` are reused unchanged, and `VERSION`
  stays 1021.

## Sources and versions

| What | Where | Version |
|---|---|---|
| In-game mod | CTR-ModSDK `decompile/General/AltMods/OnlineCTR/` (14 files, 3.0k lines) | CTR-ModSDK `e3f19686` (2026-07-05) ; OnlineCTR last changed `f41cf652` (2025-07-04), "OnlineCTR 1021.2" `53115721` |
| Game-side `#ifdef USE_ONLINE` sites | CTR-ModSDK `decompile/General/**` (~160 `#if` sites) ; in this tree, removed by `930ca3f79` | ctr-native `930ca3f793831401f7a5001c88c2eea06a21b703` |
| Mod wiring (`Mods*.c`, `ModsMain.c`) | removed by `82e743de9` | ctr-native `82e743de9db647b59247ada7416bb35e3f97ebac` |
| RAMEX (8 MB heap) and other `USE_*` guards | removed by `3621bf9b4` | ctr-native `3621bf9b43c7093f65d7f1741ea24582f9b7b0d3` |
| PC client | CTR-ModSDK `mods/Windows/OnlineCTR/Network_PC/Client/CL_main.cpp` (1341 lines) | same CTR-ModSDK commit |
| Server | CTR-ModSDK `mods/Windows/OnlineCTR/Network_PC/Server/SV_main.c` (918) + `SV_helper.c` (168) | same |
| Protocol version | `#define VERSION 1021` in `global.h` (since `9530eb4f`, 2024-12-06) | 1021 |

Upstream: https://github.com/CTR-tools/CTR-ModSDK/tree/e3f19686fb07d62847836ae77c733573a54d3534

To read a removed block in this tree:
`git show 930ca3f79 -- <old path>` (old paths are listed in the mapping
table). Source of truth for the mod itself: CTR-ModSDK at the commit above.
It is the code public servers and DuckStation players run.

## Architecture upstream

```
 DuckStation (PS1 RAM)                         CL_main.exe (Windows)            SV_main (ENet, UDP 64001)
 ┌──────────────────────────┐   shared memory  ┌──────────────────────┐  ENet    ┌──────────────────────┐
 │ game + OnlineCTR mod     │◄────────────────►│ state machine        │◄────────►│ 16 rooms × 8 peers   │
 │ octr @ 0x8000C000 (1 KB) │ "duckstation_PID"│ raw pBuf reads/writes│          │ relay + room state   │
 └──────────────────────────┘                  └──────────────────────┘          └──────────────────────┘
```

- The game side (`#ifdef USE_ONLINE` + `AltMods/OnlineCTR/*.c`) owns the
  menus (server, room, track, laps, character), overhead names, end-of-race
  UI, checkpoint/lap tracking, weapon replay of remote drivers, and the
  "ghostify" of other karts in itemless rooms.
- The client owns the network and every write into game memory that comes
  from the network: remote kart pose, remote pad buttons, character IDs,
  lap count, cheat flags.
- The server owns rooms and the lobby → load → race → end sequencing.

## Protocol

All messages are C structs with `unsigned char` bitfields, sent as raw bytes
(little-endian, LSB-first bitfields: MSVC client and GCC server already
agree). The first 4 bits are always `type`. There is one ENet channel (0).
Reliability is per message, chosen by the sender.

### Client → server (`enum ClientGiveMessageType`)

| # | Message | Struct, size | Fields (bits) | ENet flag | Sent when |
|---|---|---|---|---|---|
| 0 | `CG_JOINROOM` | `CG_MessageRoom`, 2 B | type 4, pad 4, room 8 | RELIABLE | room picked ; also `room = 0xFF` every 150 frames in `LAUNCH_PICK_ROOM` as a refresh request |
| 1 | `CG_NAME` | `CG_MessageName`, 11 B | type 4, pad 4, name[10] | RELIABLE | reply to `SG_NEWCLIENT` |
| 2 | `CG_TRACK` | `CG_MessageTrack`, 2 B | type 4, pad 4, trackID 5, lapID 3 | RELIABLE | host locked track + laps |
| 3 | `CG_CHARACTER` | `CG_MessageCharacter`, 2 B | type 4, characterID 4, boolLockedIn 1, pad 7 | RELIABLE | character or lock changed |
| 4 | `CG_STARTRACE` | `CG_Header`, 1 B | type 4, pad 4 | RELIABLE | once, when `gGT->gameMode1 & 0x40` (camera fly-in) clears |
| 5 | `CG_RACEDATA` | `CG_EverythingKart`, 10 B | type 4, wumpa 3, boolReserves 1, kartRot1 8 (angle bits 0–4), kartRot2 8 (angle bits 5–11), buttonHold 8, posX/Y/Z s16 (= pos / 256) | **UNSEQUENCED** | every frame in `GAME_WAIT_FOR_RACE` / `GAME_START_RACE` |
| 6 | `CG_WEAPON` | `CG_MessageWeapon`, 2 B | type 4, juiced 1, pad 1, flags 2, weapon 4, pad 4 | RELIABLE | own weapon fired (`octr->Shoot[0].boolNow`) |
| 7 | `CG_ENDRACE` | `CG_MessageEndRace`, 12 B | type 4, pad 4, (3 B align), courseTime s32, lapTime s32 | RELIABLE | once on `GAME_END_RACE` |

### Server → client (`enum ServerGiveMessageType`)

| # | Message | Struct, size | Fields (bits) | ENet flag | Effect on the client |
|---|---|---|---|---|---|
| 0 | `SG_ROOMS` | `SG_MessageRooms`, 12 B | type 4, pad 4, numRooms 8, version u16, 16 × numClients 4 (+8 when room locked) | RELIABLE | version check (see below) ; fills `octr->clientCount[16]`, `numRooms` ; clears `serverLockIn2` |
| 1 | `SG_NEWCLIENT` | `SG_MessageClientStatus`, 2 B | type 4, clientID 4, numClientsTotal 4, special 4 | RELIABLE | sets `DriverID`, `NumDrivers`, cheat flags by room type, resets lobby fields, replies `CG_NAME`, state → `LOBBY_ASSIGN_ROLE` |
| 2 | `SG_NAME` | `SG_MessageName`, 12 B | type 4, pad 4, clientID 4, numClientsTotal 4, name[10] | RELIABLE | `octr->nameBuffer[slot]` ; empty name = that player left |
| 3 | `SG_TRACK` | `SG_MessageTrack`, 2 B | type 4, pad 4, trackID 5, lapID 3 | RELIABLE | `octr->levelID`, `gGT->numLaps` ; state → `LOBBY_CHARACTER_PICK` |
| 4 | `SG_CHARACTER` | `SG_MessageCharacter`, 2 B | type 4, clientID 3, boolLockedIn 1, characterID 4, pad 4 | RELIABLE | `data.characterIDs[slot]`, `octr->boolLockedInCharacters[clientID]` |
| 5 | `SG_STARTLOADING` | `SG_Header`, 1 B | — | RELIABLE | state → `LOBBY_START_LOADING` |
| 6 | `SG_STARTRACE` | `SG_Header`, 1 B | — | RELIABLE | state → `GAME_START_RACE` |
| 7 | `SG_RACEDATA` | `SG_EverythingKart`, 10 B | type 4, wumpa 3, boolReserves 1, clientID 3, kartRot1 5, kartRot2 8, buttonHold 8, posX/Y/Z s16 | **UNSEQUENCED** | remote kart pose + pad (see [client memory contract](#client-memory-contract)) |
| 8 | `SG_WEAPON` | `SG_MessageWeapon`, 2 B | type 4, clientID 3, juiced 1, weapon 4, flags 2, pad 2 | RELIABLE | `octr->Shoot[slot]` → the game fires it for that driver |
| 9 | `SG_ENDRACE` | `SG_MessageEndRace`, 12 B | type 4, clientID 4, courseTime s32, lapTime s32 | RELIABLE | `octr->raceStats[numDriversEnded++]`, that slot's pad holds SQUARE |
| 10 | `SG_SERVERCLOSED` | — | — | — | declared, never sent nor handled |

Notes:

- **Only race data is unreliable.** Every lobby and race-control message,
  weapons included, is ENet RELIABLE. A lost `SG_STARTRACE` or `CG_ENDRACE`
  stalls the room.
- **Slots.** The server numbers players by `clientID` (0–7, 0 = host = track
  picker). Each client maps a remote `clientID` to a local driver slot:
  `slot = clientID + 1` if `clientID < DriverID`, `slot = clientID` if
  greater. Its own messages echoed back are dropped. Slot 0 is always the
  local player.
- **Version check** (client, on `SG_ROOMS`): it accepts `server == VERSION`,
  plus the pairs (server 1019, client 1020), (1019, 1021) and (1020, 1021).
  It also requires `octr->ver_psx == VERSION`, i.e. the game side must be
  built at the same `VERSION`. A failure sets `LAUNCH_ERROR`.
- **Room types** are fixed by index (`ROOM_IS_ITEMS` / `ROOM_IS_RETRO` in
  `global.h`): 0–4 itemless, 5–9 items, 10–12 retro, 13–15 items + retro.
- The structs are only visible to the PC programs (`#ifdef WINDOWS_INCLUDE`).
  The game side compiles none of them.

### `octr` — the shared state

`struct OnlineCTR` lives at PS1 address `0x8000C000`. It is at most 0x400
bytes (static assert) and is zeroed by `octr_entryHook()` at boot and after
every disconnect.

| Offset | Fields | Written by |
|---|---|---|
| 0x00 | `CurrState` (`enum ClientState`, < 0 = disconnected) | both |
| 0x04 | `PageNumber`, `CountPressX`, `NumDrivers`, `DriverID` | game (menus) / client (`NumDrivers`, `DriverID`) |
| 0x08 | `boolLockedInLap`, `boolLockedInLevel`, `lapID`, `levelID` | game (host picks) / client (`levelID` from `SG_TRACK`) |
| 0x0C | `IsBootedPS1`, `boolLockedInCharacter`, `numRooms`, `numDriversEnded` | game / client |
| 0x10 | `serverCountry`, `serverRoom`, `serverLockIn1`, `serverLockIn2` | game (menus), client clears `serverLockIn2` |
| 0x14 | `boolPlanetLEV`, `boolClientBusy`, `special`, pad | game / client (`special`, always 0 today) |
| 0x18 | `clientCount[16]` | client |
| 0x28 | `windowsClientSync` | client, +1 per client loop |
| 0x30 | `boolLockedInCharacters[8]` | game (own) / client (others) |
| 0x38 | `nameBuffer[8][10]` | client |
| … | `raceStats[8]` {slot, finalTime, bestLap} | client |
| … | `ver_psx`, `ver_pc`, `ver_server` | game / client / client |
| … | `Shoot[8]` {boolJuiced, Weapon, flags, boolNow} — `[0]` game → client, `[1..7]` client → game | both |
| … | `frames_unsynced`, `lastWindowsClientSync` | game (watchdog) |
| … | `readyToSend` | game sets 1, client resets 0 |
| … | `autoRetryJoinRoomIndex` | game / client |

### Client states and the frame handshake

`enum ClientState`: `LAUNCH_ENTER_PID` 0, `LAUNCH_PICK_SERVER` 1,
`LAUNCH_PICK_ROOM` 2, `LAUNCH_ERROR` 3, `LOBBY_ASSIGN_ROLE` 4,
`LOBBY_HOST_TRACK_PICK` 5, `LOBBY_GUEST_TRACK_WAIT` 6,
`LOBBY_CHARACTER_PICK` 7, `LOBBY_WAIT_FOR_LOADING` 8, `LOBBY_START_LOADING` 9,
`GAME_WAIT_FOR_RACE` 10, `GAME_START_RACE` 11, `GAME_END_RACE` 12.

The game has `StatePS1_*` handlers (`states.c`), run each frame by
`ThreadFunc` (`thread.c`). The client has `StatePC_*` handlers, run once per
client loop. Both index into `octr->CurrState`.

Client loop (`CL_main.cpp` `main`):
1. `octr->windowsClientSync++`
2. from `LAUNCH_PICK_ROOM` on, SELECT held → disconnect, `CurrState = -1`
3. `StatePC_<CurrState>()`
4. drain ENet events (`ProcessNewMessages`)
5. `FrameStall()`: busy-wait until `octr->readyToSend == 1`, then reset it
   to 0.

The game sets `octr->readyToSend = 1` in `MainFrame_GameLogic`, inside the
thread-bucket loop, after the player vehicles' per-stage physics. That is
CTR-ModSDK `decompile/General/MAIN/MainFrame_02_GameLogic.c:287-289`.

The game-side watchdog (`thread.c`): if `windowsClientSync` has not changed
for more than `DISCONNECT_AT_UNSYNCED_FRAMES` (60) frames, it treats the
client as gone and resets (`octr_entryHook()`).

### Client memory contract

What `CL_main.cpp` reads (R) or writes (W) in PS1 RAM, besides `octr`.
ctr-native keeps the PS1 struct layouts and asserts them (e.g.
`CTR_STATIC_ASSERT(offsetof(struct Driver, posCurr) == 0x2d4)` in
`include/namespace_Vehicle.h`). Every raw offset therefore has a named field.

| Raw address (PS1) | Meaning in `CL_main.cpp` | R/W | ctr-native field |
|---|---|---|---|
| `0x8009900c + 4·slot` | `gGT->drivers[slot]` | R | `sdata->gGT->drivers[slot]` (`struct Driver *`) |
| driver `+0x2d4 / 2d8 / 2dc` | position, sent as `pos / 256` in `s16` | RW | `driver->posCurr.x/y/z` (`include/namespace_Vehicle.h`, asserted at `0x2d4`) |
| driver `+0x39a` | facing angle, 12 bits | RW | `driver->angle` (`s16`) |
| driver `+0x30` | wumpa count | RW | `driver->numWumpas` (`s8` ; the client writes a `short` here — upstream bug, harmless on little-endian ; the bridge writes the `s8`) |
| driver `+0x3e2` | reserves ; sent as `reserves > 200`, received as `= 200` | RW | `driver->reserves` (`s16`, read unsigned upstream) |
| driver `+0x514` (`DRIVER_COURSE_OFFSET`) | course time for `CG_ENDRACE` | R | `driver->timeElapsedInRace` (`int`, comment `0x514`) |
| driver `+0x63c` (`DRIVER_BESTLAP_OFFSET`) | best lap for `CG_ENDRACE` | R | `driver->bestLapTime` — an **online-only field** (`struct Driver` row of the mapping table) |
| `0x80096804 + 0x50·slot` | `struct Gamepad` of slot (`0x50` bytes) | W (slots 1–7) | `sdata->gGamepads->gamepad[slot]` (`struct GamepadBuffer`, asserted `0x50`) |
| `… + 0x10` | `buttonsHeldCurrFrame` (also `buttonsTapped`, `buttonsReleased`, `buttonsHeldPrevFrame`, `stickLX`, `stickLY`) | R (slot 0) / W (slots 1–7) | `gamepad[slot].buttonsHeldCurrFrame` etc. (`include/namespace_Gamepad.h:172`) |
| `0x80086e84 + 2·slot` | character IDs | RW | `data.characterIDs[slot]` (`GAME_CHARACTER_IDS`) |
| `0x80096b20 + 0x0` | `gGT->gameMode1` (`0x40` = camera fly-in) | R | `sdata->gGT->gameMode1` |
| `0x80096b28` (`gGT + 0x8`) | cheat flags cleared on join ; `0x100000` set in retro rooms | W | `sdata->gGT->gameMode2` : `CHEAT_MASK 0x400`, `CHEAT_ENGINE 0x10000`, `CHEAT_ICY 0x80000`, `CHEAT_TURBOPAD 0x100000`, `CHEAT_BOMBS 0x400000` (`enum GameMode2`) |
| `0x80096b20 + 0x1a10` | `gGT->levelID` (`0x26` = globe / lobby) | R | `sdata->gGT->levelID` |
| `0x80096b20 + 0x1d33` | `gGT->numLaps` | W | `sdata->gGT->numLaps` (`s8`) |
| `0x8008d0f8` | loading stage (`-1` = loaded) | R | `sdata->Loading.stage` (`GAME_LOADING_STAGE`) |
| `0x80098028` (`gGT + 0x1508`) | demo-camera mode, inside a `#if 0` block | — | not ported |

Button packing in `CG_RACEDATA.buttonHold` : Circle (`0x40`) and L2 (`0x80`)
are dropped, L1 (`0x400`) and R1 (`0x800`) take their bits. The receiver
rebuilds `buttonsTapped` / `buttonsReleased` from its own previous value and
sets `stickLX` / `stickLY` to `0x00` / `0x80` / `0xFF` from the D-pad bits.

## Server behaviour

- ENet host on `ENET_HOST_ANY:<port>` (`-p`, Docker image uses 64001),
  256 peers, 2 channels (only 0 is used). Optional IP ban list (`-b`).
  Peer timeout is 2 s in the room list and 5 s once in a room.
- 16 `RoomInfo` × 8 `PeerInfo` {peer, name, characterID, boolLoadSelf,
  boolRaceSelf, boolEndSelf}. Each room has `clientCount`, `levelPlayed`,
  `boolRoomLocked`, `boolLoadAll`, `boolRaceAll`, `boolEndAll`, `endTime`.
- Connect: add to the lobby peer list, unicast `SG_ROOMS`.
- `CG_JOINROOM`: reject (re-send `SG_ROOMS`) if `room > 16`, locked, full or
  duplicate (same IP **and** port). Otherwise take the first free slot,
  broadcast `SG_ROOMS` to the lobby and send `SG_NEWCLIENT` (slot 0 = host).
- `CG_NAME`: store it, send every other name to the joiner, broadcast the
  joiner's name to the room.
- `CG_TRACK`: lock the room, store `levelPlayed`, broadcast `SG_TRACK`,
  refresh `SG_ROOMS` to the lobby.
- `CG_CHARACTER`: store it, `boolLoadSelf = boolLockedIn`, broadcast
  `SG_CHARACTER`.
- `CG_STARTRACE`: `boolRaceSelf = 1`.
- `CG_RACEDATA`: re-pack as `SG_RACEDATA` with the sender's `clientID`,
  broadcast unreliably to the whole room, sender included.
- `CG_WEAPON`: broadcast `SG_WEAPON` (reliable). `CG_ENDRACE`:
  `boolEndSelf = 1`, broadcast `SG_ENDRACE`.
- Tick (`ServerState_Tick`, busy loop with `usleep(1)`):
  - all loaded → `SG_STARTLOADING`;
  - all raced → `SG_STARTRACE`;
  - all ended → after 6 s, reset the room (`SG_NEWCLIENT` to everyone,
    `SG_ROOMS` to the lobby).
  - The 6 s are measured with `clock()`, CPU time with a
    `CLOCKS_PER_SEC_FIX` hack on POSIX. They are not wall-clock time.
- Disconnect:
  - If the room is empty, or a race is running with ≤ 1 player on a
    non-race map (`levelPlayed > 18`): kill the room.
  - Otherwise free the slot, mark it loaded/raced so nobody waits, and
    broadcast an empty `SG_NAME`.
  - The host leaving is not handled: there is no re-election (upstream TODO).
- No game logic, no validation of kart data: the server trusts clients.

## Game functions touched by OnlineCTR

Every game function that carried an `#ifdef USE_ONLINE` block (from
`930ca3f79`) or a call into the mod (from `82e743de9`), with its location
today. Class: **I** = the hunk's context lines are still there, the block
re-applies as text ; **R** = the function was restructured (new signature,
merged logic, runtime checks instead of `#ifdef`) and the block is adapted
by hand ; **M** = gone. Old path = `game/…` as of `930ca3f79`.

### Wiring and hooks (from `82e743de9`)

| Upstream site | What it did | Today | Class |
|---|---|---|---|
| `ModsMain()` called from `StateZero()` (`game/MAIN/MainMain.c`) under `USE_ALTMODS` ; `ModsMain.c` calls `octr_entryHook()` | boot-time init : `StatsUpgrade()`, disable `BOTS_Driver_Convert` (raw MIPS poke), drop cutscene models, zero `octr`, `IsBootedPS1 = 1`, `ver_psx = VERSION` | `game/MAIN/MainMain.c:492` `StateZero()` ; no mod entry hook exists any more | R — add one `USE_ONLINE` call to `octr_entryHook()` in `StateZero()` ; the MIPS poke becomes an early return in `BOTS_Driver_Convert` (`game/BOTS.c:3906`) |
| `ModsMain.c` includes `hooks.c menu.c states.c thread.c endOfRaceUI.c meterGrade.c` ; `Mods2.c` `mods2.c` ; `Mods4.c` `names3d.c vehThread.c hsvColor.c` ; `Mods7.c` `global.h` ; `Mods8.c` `lap.c` | compile the mod into the unity build | `game/game_unity.h` (no `AltMods`) | R — include `game/OnlineCTR/*.c` from `game_unity.h` under `USE_ONLINE` ; `debugcam.c` and `zMirrorMode.c` are not ported (see D2) |
| `MainInit_07_FinalizeInit.c` : `OnlineInit_Drivers()` instead of `MainInit_Drivers()`, then `octr_initHook()` + early return | 8 spawn slots, remote drivers as humans, spawn the `ThreadFunc` thread, skip confetti | `game/MAIN/MainInit.c:404` `MainInit_FinalizeInit()` | R — calls `MainInit_Drivers()` unconditionally ; the confetti init that online skipped is no longer guarded |
| `MainFrame_08_RenderFrame.c` `RenderAllHUD` : `OnlineEndOfRace()` ; `#ifndef USE_ONLINE` around `UI_RenderFrame_CrystChall`, `WindowBoxLines`, `WindowDivsionLines`, `UI_RenderFrame_AdvHub` | end-of-race screen, no split-screen lines | `game/MAIN/MainFrame_RenderFrame.c:477` `RenderAllHUD`, `:1043` `WindowBoxLines`, `:1076` `WindowDivsionLines` | I |
| `MainFrame_08_RenderFrame.c` `RenderSubmit` : `#if 0 && defined(USE_ONLINE)` `OnlineMirrorMode()` | mirror mode (disabled upstream) | `game/MAIN/MainFrame_RenderFrame.c:1273` | I — stays disabled, not ported |
| `MainFrame_02_GameLogic.c:246` : `RunVehicleThread(pcVar5, th, driver)` instead of `pcVar5(th, driver)` ; `:287` `octr->readyToSend = 1` ; `:205` skip `STATIC` / `SPIDER` buckets while `trafficLightsTimer > 3600` | wrap every driver stage call (checkpoint tracker, `END_OF_RACE` handling) ; frame handshake ; hazard sync | `game/MAIN/MainFrame.c:324-329` (stage loop) and `:333` (before `ThTick_RunBucket`) | I — the `readyToSend` line becomes the `NativeOnline_Frame()` call (D3) |
| `PROC_09_CollidePointWithBucket.c:8` : `Online_CollidePointWithBucket()` + return | item-room only bucket collision | `game/PROC.c:336` `PROC_CollidePointWithBucket(struct Thread *, struct BucketSearchParams *)` | R — signature changed from `short *vec3_pos` to `struct BucketSearchParams *` ; `mods2.c` must take the new type |
| `h122_OtherFX_RecycleNew.c:10` : `Online_OtherFX_RecycleNew()` + return | mute sounds of drivers other than P1 | `game/HOWL/HOWL_OtherFXRecycle.c:3` `OtherFX_RecycleNew` | I |

### `game/MAIN`, `LOAD`, `GAMEPAD`, `HOWL`, `CAMERA`, `PlayLevel`, data

| Function (old path) | Online block | Today | Class / note |
|---|---|---|---|
| `MainFrame_GameLogic` (`MAIN/MainFrame_02_GameLogic.c`) | see wiring row ; also only P1's driver is used for the attack-quip logic | `game/MAIN/MainFrame.c:119` | I |
| `MainFrame_RenderFrame` (`MAIN/MainFrame_08_RenderFrame.c`) | `#ifndef USE_ONLINE` around the split-screen lines and AdvHub UI | `game/MAIN/MainFrame_RenderFrame.c:16` | I |
| `RenderAllHUD`, `WindowDivsionLines`, `WindowBoxLines`, `RenderSubmit` (same file) | see wiring rows | `:477`, `:1076`, `:1043`, `:1273` | I |
| `MultiplayerWumpaHUD` (same file) | none — appears in the diff as hunk context only | not found by name in `game/MAIN/MainFrame_RenderFrame.c` | — no block to re-apply |
| `MainGameStart_Initialize` (`MAIN/MainGameStart_00_Initialize.c`) | `#ifndef USE_ONLINE` around `VehBirth_TeleportAll()` | `game/MAIN/MainGameStart.c:3` | I |
| `MainInit_JitPoolsNew` (`MAIN/MainInit_05_JitPoolsNew.c`) | pool sizes forced : 8 drivers, 0x1000 bytes, 1200 particles | `game/MAIN/MainInit.c:213` | R — pool sizing now goes through a `poolScale` variable ; apply the 8-driver / particle override on it |
| `MainInit_FinalizeInit` (`MAIN/MainInit_07_FinalizeInit.c`) | see wiring row | `game/MAIN/MainInit.c:404` | R |
| `StateZero` (`MAIN/MainMain.c`) | first level = `INTRO_OXIDE` (the globe, `0x26`) ; `Music_SetIntro` skipped ; `MEMPACK_SIZE` 8 MB under RAMEX | `game/MAIN/MainMain.c:492` (`MEMPACK_SIZE` at `:509`) | R — level ID is `NAUGHTY_DOG_CRATE` unconditionally today ; add the three `USE_ONLINE` branches |
| `LOAD_Robots1P` (`LOAD/LOAD_30_Robots1P.c`) | early return | `game/LOAD/LOAD_Assets.c:65` | I |
| `LOAD_DriverMPK` (`LOAD/LOAD_31_DriverMPK.c`) | `goto ForceOnlineLoad8` : always load 8 driver models | `game/LOAD/LOAD_Assets.c:94` `LOAD_DriverMPK(struct BigHeader *, int, callback)` | R — signature changed from `(unsigned int, int)` |
| `LOAD_TenStages` (`LOAD/LOAD_44_TenStages.c`) | `levelID == INTRO_OXIDE` → `ovrRegion3 = 3` | `game/LOAD/LOAD_TenStages.c:30` | I |
| `GAMEPAD_PollVsync` (`GAMEPAD/GAMEPAD_03_PollVsync.c`) | `numPorts = 1`, `maxPadsPerPort = 1` : poll P1 only, never touch slots 1–7 | `game/GAMEPAD.c:112` | I |
| `GAMEPAD_GetNumConnected` (`GAMEPAD_04`) | report 1 pad | `game/GAMEPAD.c:210` | I |
| `GAMEPAD_ProcessHold`, `GAMEPAD_ProcessSticks`, `GAMEPAD_ProcessTapRelease` (`GAMEPAD_05/06/07`) | `break` after P1 : remote pads are not recomputed from hardware | `game/GAMEPAD.c:319`, `:533`, `:731` | I — see R7 |
| `Audio_Update1` (`HOWL/h104_Audio_Update1.c`) | `d = gGT->drivers[0]` instead of searching the first human | `game/HOWL/HOWL_AudioState.c:185` | R — the search now walks `driversInRaceOrder` in several `switch` cases ; make each take `drivers[0]` under `USE_ONLINE` |
| `OtherFX_RecycleNew` (`HOWL/h122`) | see wiring row | `game/HOWL/HOWL_OtherFXRecycle.c:3` | I |
| `CAM_StartOfRace` (`CAMERA/CAM_06_StartOfRace.c`) | return unless `cDC == &gGT->cameraDC[0]` ; restart-point condition without `numPlyrCurrGame == 1` | `game/CAM.c:532` | R — the `numPlyrCurrGame` test is gone, re-check the condition |
| `PROC_CollidePointWithBucket` (`PROC/PROC_09`) | see wiring row | `game/PROC.c:336` | R |
| `PlayLevel_UpdateLapStats` (`PlayLevel/PlayLevel_0_UpdateLapStats.c`) | 11 sites : `HANDLE_NULL_DRIVER` = `break` ; per-driver `currLapTime` / `bestLapTime` / `firstRank` ; rank from `numDead` / `numSpawn` ; end-of-race condition | `game/PlayLevel.c:29` | R — the biggest adaptation ; the fields it writes come back with `struct Driver` below |
| `struct Data` (`zGlobal_DATA.c`) | item-set tables `RNG_itemSetRace2/3/4` differ under `USE_ONLINE` | `game/zGlobal_DATA.c` | R — port upstream's online tables as-is : item odds must match DuckStation players |
| `include/common.h` | `#define USE_BOOSTBAR / USE_16BY9 / USE_RAMEX / USE_BIGQUEUE / USE_DRIVERLOD / USE_RETROFUELED` under `USE_ONLINE` | not present | M — only RAMEX matters (D1) ; BoostBar's online bar and 16BY9 are optional visuals, see R12 |
| `struct Driver` (`include/namespace_Vehicle.h`) | adds `uncappedReserves 0x638`, `bestLapTime 0x63c`, `currLapTime 0x640`, `meterGrade[2] 0x644`, `meterGradeTimer 0x646`, `gradeColor 0x648` ; `sizeof` assert only when not online | fields absent ; `DRIVER_NTSC_RETAIL_SIZE = 0x62c`, ghost tape at `0x62c`, "end of ghost struct" at `0x638` | R — re-add the six fields after `ghostPadding_0x636` under `USE_ONLINE` ; pools are sized from `sizeof(struct Driver)` / `DRIVER_NTSC_RETAIL_SIZE` (`game/BOTS.c:3875`) : check every `memset` / pool size that assumes 0x638 |

### `game/UI` and `DecalFont`

ctr-native rewrote most of the HUD : numbered files were merged, magic
numbers became named constants, several `#ifdef` branches became runtime
checks on `gGT->numPlyrCurrGame`. All 16 are **R**.

| Function (old path) | Online block | Today |
|---|---|---|
| `UI_INSTANCE_BirthWithThread` (`UI_07`) | `driver = gGT->drivers[0]` | `game/UI/UI_Instance.c:42` |
| `UI_INSTANCE_InitAll` (`UI_08`) | skip BIG1 / CTR letters init | `game/UI/UI_Instance.c:231` |
| `UI_Map_DrawRawIcon` (`UI_12`) | `posY -= 50` | `game/UI/UI_Map.c:222` |
| `UI_Map_DrawDrivers` (`UI_13`) | `driverID == 0` is the player | `game/UI/UI_Map.c:250` (runtime `ACTION_BOT` test today) |
| `UI_DrawDriverIcon` (`UI_19`) | full tex coords, no Y clipping | `game/UI/UI_Icon.c:269` |
| `UI_Lerp2D_Angular` (`UI_20`) | `+(angle*0x14>>0xc)+10` | `game/UI/UI_Lerp2D.c:13` (rewritten with `MATH_Sin`) |
| `UI_DrawRaceClock` (`UI_23`) | 6 sites : time format, `bestLapTime` / `currLapTime` display | `game/UI/UI_Clock.c:29` |
| `UI_BattleDrawHeadArrows` (`UI_25`) | `numPlyr = OnlineGetNumDrivers()` | `game/UI/UI_RaceHud.c:69` (`numPlyrCurrGame` at `:103`) |
| `UI_DrawLapCount` (`UI_28`) | `sprintf` with `s_intDividing` | `game/UI/UI_RaceHudText.c:48` (runtime `< UI_LAP_COUNT_SPLIT_PLAYER_COUNT` at `:63`) |
| `UI_DrawSpeedNeedle` (`UI_38`) | `maxScale = 100`, speed from `MATH_FastSqrt` | `game/UI/UI_Speedometer.c:3` |
| `UI_DrawSpeedBG` (`UI_39`) | inline colour / vertex arrays | `game/UI/UI_Speedometer.c:124` (uses `data.speedometerBG_vertData`) |
| `UI_JumpMeter_Draw` (`UI_41`) | green / yellow / red gradient, offsets | `game/UI/UI_JumpMeter_Draw.c:31` |
| `UI_DrawSlideMeter` (`UI_42`) | meter grade for `driverID == 0`, offsets | `game/UI/UI_DrawSlideMeter.c:15` |
| `UI_DrawRankedDrivers` (`UI_43`) | `OnlineGetNumDrivers()`, names + timers | `game/UI/UI_Rank.c:80` (`numPlyrCurrGame` at `:86`) |
| `UI_RenderFrame_Racing` (`UI_44`) | 10 sites : `WIDE_PICK` offset, driver selection, HUD positions | `game/UI/UI_RenderFrame.c:6` |
| `UI_AAA_BigBlock1.c` / `DecalFont_DrawLineStrlen` (`DecalFont_2`) | `#if BUILD >= JpnTrial \|\| defined(USE_ONLINE)` flag mask | `game/DecalFont.c:55` (`flags &= 0xfff` at `:69`) |

Session 8 ports what a compatible race needs (driver selection, player
count, lap / clock from `octr` and the new `struct Driver` fields, overhead
names from `names3d.c`). The visual-only tweaks (`posY -= 50`, gradients,
`WIDE_PICK`) are optional and listed in LOG when skipped.

### `game/Vehicle` and `game/231` (items)

| Function (old path) | Online block | Today | Class |
|---|---|---|---|
| `RB_Player_ModifyWumpa` (`231/231_002`) | only `driverID == 0` changes wumpa | `game/231/RB_Player.c:141` | I |
| `RB_ShieldDark_ThTick_Grow` (`231/231_038`) | `player->driverID == 0` instead of the bot flag | `game/231/RB_MaskShieldCloud.c:432` | I |
| `RB_CrateWeapon_LInC` (`231/231_061_068`) | `driverID != 0` → return 0 ; no pickup after `END_OF_RACE` ; `ROOM_IS_ITEMS` | `game/231/RB_Crate.c:244` | I |
| `RB_CrateFruit_LInC` (same) | `driverID != 0` → `RB_Player_ModifyWumpa`, return 0 | `game/231/RB_Crate.c:374` | I |
| `RB_CrateTime_LInC` (same) | `driverID != 0` → return | `game/231/RB_Crate.c:523` | I |
| `RB_Follower_Init` (`231/231_092_094`) | `d->driverID != 0` | `game/231/RB_Follower.c:76` | I |
| `VehBirth_TeleportSelf` (`Vehicle/VehBirth_0`) | `CAM_StartOfRace` only for `driverID == 0` | `game/Vehicle/VehBirth.c:476` | I |
| `VehBirth_EngineAudio_AllPlayers` (`VehBirth_4`) | `d = drivers[0]`, break | `game/Vehicle/VehBirth.c:703` | I |
| `VehFire_Audio` (`VehFire_0`) | `driverID != 0` → return | `game/Vehicle/VehFire.c:35` | I |
| `VehFire_Increment` (`VehFire_1`) | 7 sites : `FixReservesIncrement()` (uncapped reserves), `driverID` checks | `game/Vehicle/VehFire.c:100` | R — `driver->reserves +=` is direct today (`:363`) ; needs `uncappedReserves` back |
| `VehPhysGeneral_SetHeldItem` (`VehPhysGeneral_5`) | `ROOM_IS_ITEMS` item-set override | `game/Vehicle/VehPhysGeneral.c:1681` | I |
| `VehPhysProc_Driving_PhysLinear` (`VehPhysProc_00`) | 6 sites : `uncappedReserves` decay for `i == 0` ; `ROOM_IS_ITEMS` bomb / shield feedback | `game/Vehicle/VehPhysProc.c:234` (timers at `:251-260`) | R — uniform timer loop today |
| `VehPhysProc_Driving_Audio` (`VehPhysProc_01`) | `driverID != 0` → return | `game/Vehicle/VehPhysProc.c:1631` | I |
| `VehPhysProc_PowerSlide_Update` (`VehPhysProc_11`) | echo FX only for `driverID == 0` | `game/Vehicle/VehPhysProc.c:2528` | I |
| `VehPhysProc_SpinFirst_Init` (`VehPhysProc_24`) | voice line only for `driverID == 0` | `game/Vehicle/VehPhysProc.c:2873` | I |
| `VehPickState_NewState` (`VehPickState_0`) | `attackDriver->driverID != 0` → return | `game/Vehicle/VehPickState.c:48` | I |
| `VehPickupItem_MaskUseWeapon` (`VehPickupItem_1`) | `driverID == 0` in 3 places | `game/Vehicle/VehPickupItem.c:193` | I |
| `VehPickupItem_ShootNow` (`VehPickupItem_4`) | in item rooms, P1's shot fills `octr->Shoot[0]` (juiced = `numWumpas >= 10`, `heldItemID`, `flags & 3`, `boolNow = 1`) — the only place the game emits a weapon event | `game/Vehicle/VehPickupItem.c:579` | I |
| `VehStuckProc_MaskGrab_Update`, `VehStuckProc_MaskGrab_Animate` (`VehStuckProc_02/04`) | `driverID == 0` guards | `game/Vehicle/VehStuckProc.c:436`, `:479` | I |
| `VehStuckProc_PlantEaten_Animate` (`VehStuckProc_08`) | `driverID != 0` → return | `game/Vehicle/VehStuckProc.c:775` | I |
| `VehStuckProc_RevEngine_PhysLinear`, `VehStuckProc_RevEngine_Animate`, `VehStuckProc_RevEngine_Init` (`VehStuckProc_12/13/14`) | `driverID` guards | `game/Vehicle/VehStuckProc.c:1023`, `:1098`, `:1320` | I |
| `VehBirth_SetConsts` (`VehBirth_3`, from `82e743de9`) | `AltMods` include site only | `game/Vehicle/VehBirth.c` | — no online block |

The pattern behind most Vehicle rows : upstream decides "is this the
local player" by `driverID == 0`, because remote karts are human drivers
(not bots) in slots 1–7. ctr-native often tests `ACTION_BOT` instead,
which is true for nobody online. Each `I` row is still re-read for that.

## Decisions

### D1 — Build flag: `CTR_ONLINE` → `USE_ONLINE`

A CMake option `CTR_ONLINE` (default `OFF`) defines `USE_ONLINE`. These are
the names CTR-ModSDK's `rebuild_PC/CMakeLists.txt` uses
(`cmake_dependent_option(CTR_ONLINE …)` → `-DUSE_ONLINE`), so every
re-applied block keeps upstream's guard and diffs cleanly against
CTR-ModSDK.

- Upstream makes online depend on RAMEX, the 8 MB heap needed for 8
  drivers' models. ctr-native removed RAMEX (`3621bf9b4`) and fixed
  `MEMPACK_SIZE` at 2 MB (`game/MAIN/MainMain.c`). Under `USE_ONLINE`,
  `MEMPACK_SIZE` becomes `0x800000`; RAMEX does not come back as a
  separate flag.
- Off by default: the single-player build is byte-for-byte unchanged when
  the flag is off. That is the first regression check.

### D2 — In-game code: `game/OnlineCTR/`, upstream text, raw addresses removed

The 14 mod files go back under `game/OnlineCTR/`, taken from CTR-ModSDK at
`e3f19686` (OnlineCTR 1021.2), not from the older copy deleted by
`82e743de9`. They are included from `game/game_unity.h` under
`#ifdef USE_ONLINE`, in the order the old `Mods*.c` files used.

Three upstream constructs cannot survive outside an emulator:

- `octr` at fixed address `0x8000C000` (`global.h`) becomes a static
  `struct OnlineCTR` storage plus the same `octr` pointer name. The mod code
  is otherwise unchanged.
- **Raw MIPS / RAM pokes**:
  - `hooks.c` `octr_entryHook` writes `jr ra; nop` over
    `BOTS_Driver_Convert` (`*(int*)0x80017318 = 0x3E00008`). This becomes a
    `USE_ONLINE` early return in `BOTS_Driver_Convert` (`game/BOTS.c`).
  - `states.c` `ResetPsxGlobals` sets the mempack end to `0x80800000`. This
    becomes the native 8 MB heap end (D1).
- `zMirrorMode.c` `ParseOT` walks the PS1 ordering table through 24-bit
  pointers (`*header & 0xffffff | 0x80000000`). Mirror mode is disabled
  upstream (the `OnlineMirrorMode()` call in `RenderSubmit` sits under
  `#if 0 && defined(USE_ONLINE)` ; `names3d.c` carries a "Mirror Mode
  Disabled" comment), so the file is not ported. If mirror
  mode is ever wanted, it gets rewritten against ctr-native's OT
  (`CtrGpu_PackOTTag`, `include/gpu.h`).

The game-side `#ifdef USE_ONLINE` blocks are re-applied function by function
from the [mapping table](#game-functions-touched-by-onlinectr). The text
comes from CTR-ModSDK; `930ca3f79` shows how the same block sat in
ctr-native's own copy.

### D3 — Client bridge: in-process C, between `octr` and a transport interface

`CL_main.cpp` is Windows-only. It finds DuckStation by process name, maps
`duckstation_<PID>` and reads console input. It becomes a C module in the
host layer, `platform/native_online.c`. Its parts:

- the 13 `StatePC_*` handlers, `ProcessReceiveEvent`, `SendEverything` and
  `DisconSELECT`, kept in upstream order and naming;
- every `pBuf[0x8…]` access replaced by the named field (see the
  [client memory contract](#client-memory-contract));
- console prompts (name, server pick, private IP) replaced by values the
  host layer passes in: player name and server address from the command
  line natively, from the room link in the browser;
- `LAUNCH_ENTER_PID` skipped: nothing to attach to. The game starts in
  `LAUNCH_PICK_SERVER`.

**When it runs.** Upstream runs the client loop once per game frame,
gated by `octr->readyToSend`, which `MainFrame_GameLogic` sets after the
player bucket's physics. In-process, that line becomes a direct call,
`NativeOnline_Frame()`, at the same place: drain incoming messages → run
`StatePC_<CurrState>` → send. The `readyToSend` / `FrameStall` handshake
disappears. `windowsClientSync` is still incremented by the bridge every
frame so the game-side watchdog (`thread.c`) keeps its meaning: it now
fires only when the bridge stops being called. If that call site does not
run every frame in the lobby (level `0x26`), a second call goes at the top
of `MainFrame_GameLogic`, guarded so it runs once per frame. Session 8
checks this (R6).

**Transport interface** (`platform/native_online_transport.h`), the only
thing the bridge knows about the network:

```c
typedef struct OnlineTransport {
    int  (*connect)(const char *address);           /* async ; poll() reports the result */
    void (*send)(const void *buf, int len, int reliable);
    int  (*poll)(void *buf, int cap, int *event);   /* non-blocking ; DATA / CONNECTED / DISCONNECTED */
    void (*disconnect)(void);
} OnlineTransport;
```

`reliable = 1` maps to ENet RELIABLE and `0` to UNSEQUENCED, exactly where
upstream calls `sendToHostReliable` / `sendToHostUnreliable`. Backends:

| Backend | Where | Session |
|---|---|---|
| ENet client | `platform/native_online_enet.c` (ENet vendored under `externals/enet/`) | 8 |
| Loopback to the in-process server | `platform/native_online_loopback.c` (host only) | 8 (used natively by the headless tests, then by the web host) |
| Browser (`web/net/`: WebRTC DataChannels, else WebSocket via `ctr-relay`) | `platform/web_online_transport.c` + JS glue | 9 |

### D4 — Server: one C core, natively behind ENet, in the browser inside the host's wasm

`SV_main.c` / `SV_helper.c` are split into:

- **`platform/online_server/sv_core.c`**: rooms, `PeerInfo`, every `CG_*`
  handler, the tick, the disconnect rules. No ENet, no `clock()`, no
  `printf` to stdout. Its API:
  - entry points: `SvCore_Connect(peerId)`, `SvCore_Receive(peerId, buf, len)`,
    `SvCore_Disconnect(peerId)`, `SvCore_Tick(nowMs)`;
  - outputs, through callbacks: `send(peerId, buf, len, reliable)`,
    `kick(peerId)` and `log(...)`.
  - The duplicate-connection check (same IP **and** port) becomes a
    per-peer opaque address key supplied by the adapter.
  - The 6 s room reset uses the injected `nowMs` (wall time) instead of
    upstream's CPU-time `clock()`.
- **`sv_enet_main.c`**: a drop-in for upstream's `main` (`-p`, `-b` ban list),
  built natively. It exists to diff behaviour against the original server
  on the same scripted clients.
- **In the browser**, `sv_core.c` is compiled into the same wasm as the
  game, active only on the host. The host page feeds it guest messages
  arriving on the session-4 transport. The host's own client reaches it
  through the loopback backend. The host calls `SvCore_Tick` once per
  frame from the bridge.

Why C rather than a JS port:

- One implementation of the room rules, which also runs natively against
  upstream clients. A JS port would be a second copy to keep compatible
  with public servers.
- Upstream's server is ~1.1k lines of plain C. Once ENet, argument parsing
  and printing are moved to the adapter, what remains has no host
  dependency.

Why inside the game wasm rather than a separate module:

- The host is always also a player. If its game loop stalls, the room
  stalls anyway.
- One wasm means no second build, no second loader, and loopback by
  function call.

If measurements in session 11 show host frame hitches hurting guests, the
same `sv_core.c` builds as a small separate wasm in a Worker without code
changes.

### D5 — Compatibility with public OnlineCTR servers (session 10)

- The message structs and enums are `global.h` from CTR-ModSDK,
  unchanged. They are shared by the bridge, `sv_core.c` and the tests, and
  are never re-declared.
- Keep upstream's `STATIC_ASSERT2` sizes. Add a **golden-byte test**: each
  message is packed with known field values and compared to bytes produced
  by upstream's own structs compiled with GCC (natively) and by
  Emscripten's clang (wasm32). Bitfield layout is the one compiler-defined
  part of the wire format.
- `VERSION` stays 1021 and the client keeps upstream's acceptance rule. A
  version bump upstream is a re-sync of the mod + `global.h` from
  CTR-ModSDK, nothing local.
- One payload per transport message, exactly the bytes ENet would carry,
  so the session-10 gateway is a pure byte pump: one ENet peer per browser
  client, so upstream's same-IP-and-port duplicate check does not merge
  two browsers behind the gateway. On the DataChannel leg, `reliable`
  picks the channel (D7).

### D6 — ASYNCIFY: network callbacks never call into wasm

`CTR_Main()` never returns, and with ASYNCIFY its stack is unwound while
`VSync()` sleeps. Calling an exported wasm function from a DataChannel or
WebSocket callback during that sleep re-enters a suspended module. So:

- JS callbacks only push `{peer, bytes, reliable}` into a JS-side queue.
- The bridge drains that queue at the start of `NativeOnline_Frame()`,
  through `poll()` of the web backend.
- Outgoing sends are synchronous calls from wasm into JS, which is allowed.

The same rule applies to `sv_core.c` on the host.

### D7 — Reliable control messages ride a reliable, ordered DataChannel

OnlineCTR sends only `CG_RACEDATA` / `SG_RACEDATA` unreliably. Everything
else (room, name, track, character, start loading, start race, weapons,
end race) is ENet RELIABLE, and the room state machine assumes it arrives.

The WebRTC backend therefore opens **two DataChannels** per peer:

- `race`: unordered, `maxRetransmits: 0`, for `reliable = 0`;
- `ctl`: ordered, reliable, for `reliable = 1`.

The WebSocket path through `ctr-relay` is reliable already and carries
both. This completes the original rule ("Online-mode messages go over
DataChannels, unordered and unreliable"), which only covers kart states.

## What session 8 validates natively

This container is aarch64, with no `cmake` and no `-m32`. ctr-native's
native game build is 32-bit only (`build.sh` passes `-m32`;
`docs/MEMORY_MODEL.md`), so session 8 splits validation in two. The first
half needs no game build.

**A. Headless, 64-bit, in the container**: everything except the game.

1. **Wire format**: golden-byte test of every `CG_*` / `SG_*` struct (D5),
   built with the container's GCC and, once session 1's toolchain exists,
   with `emcc`.
2. **Original server, unchanged**: upstream `SV_main.c` + `SV_helper.c`
   built against ENet on aarch64. Upstream builds it 32-bit (`i386` Docker
   image), so this is the first thing to prove (R4).
3. **Scripted clients**: a test binary drives N copies of the bridge
   (`native_online.c` + ENet backend) through a stub `octr` / game state,
   with no rendering. It covers: join room, names, host picks track,
   characters lock, start loading, start race, `CG_RACEDATA` exchange, end
   race, room reset after 6 s, one client disconnecting mid-race. Assertions
   are on `octr` fields and on the stub driver fields (remote pose, pad
   bits, slot mapping), not on logs.
4. **Same script against `sv_core.c` behind `sv_enet_main.c`**: the message
   trace (types, sizes, recipients, reliability) must equal the trace
   against the original server, except for documented timing differences.
5. **Loopback backend**: the same script with the host's client on
   loopback and the others on ENet.

**B. Game build with `CTR_ONLINE`**, on whatever 32-bit toolchain is
available (session 1's `emcc` / wasm32, or an i386 / x86 host):

6. `CTR_ONLINE=OFF` builds and its existing `ctest` suite passes,
   unchanged.
7. `CTR_ONLINE=ON` compiles and links. Every re-applied block is checked
   against the mapping table.
8. Two game instances (or one game + the scripted clients of A) against
   the original ENet server on loopback: menus reach the room list, a room
   is joined, a race starts and both karts move on both sides. This is
   session 8's live check. If no 32-bit toolchain can run the game in
   session 8, the check moves to the first session that has one, and
   session 8 says so in its LOG.

## Risks and unknowns

| # | Risk / unknown | How session 8 retires it |
|---|---|---|
| R1 | **No 32-bit native toolchain here.** The container is aarch64 with no `cmake` and no `-m32`; the game build is 32-bit only. | Do part A of validation first: it needs no game build. For part B, use session 1's toolchain if it exists (`emcc` → wasm32 is 32-bit), else an i386 / x86 host. Record which one in LOG. Never patch the game for 64-bit to get around it. |
| R2 | **RAMEX dropped in ctr-native.** Online with 8 drivers needs the 8 MB heap (`MEMPACK_SIZE 0x200000` today). | D1: 8 MB under `USE_ONLINE`. Check by loading an 8-driver race (part B 8) with `MEMPACK` usage logged. |
| R3 | **Restructured functions.** Some blocks no longer apply as text: signatures changed, code was merged, files were folded. | The mapping table marks each one. Session 8 adapts those by hand and re-reads each against CTR-ModSDK's version before moving on. |
| R4 | **Original server on 64-bit.** `SV_main.c` casts pointers to `unsigned int` (room index arithmetic) and is built 32-bit upstream. | Build it on aarch64 with warnings on. If it misbehaves, build it in an i386 container (`--platform linux/386`, if Docker in the container allows it) or keep it 64-bit with a one-line local fix recorded as a test-only patch, never in `sv_core.c`. |
| R5 | **Bitfield layout across compilers.** The wire format is struct bitfields; MSVC (client) and GCC (server) already agree upstream, wasm32 clang has not been checked. | Golden-byte test (D5) on GCC now, on `emcc` as soon as it is available. |
| R6 | **Bridge call site.** Upstream sets `readyToSend` inside the thread-bucket loop of `MainFrame_GameLogic`. It is not certain this runs every frame in the lobby (level `0x26`) and during loading. | Log a frame counter at the call site through the whole flow (menu → room → loading → race → end). If frames are missing, add the guarded second call (D3). |
| R7 | **Remote pads.** The bridge writes remote drivers' buttons and sticks into pad slots 1–7. ctr-native fills pads from `native_libpad.c` / `native_input.c` every frame and could overwrite them. The online blocks in `GAMEPAD_*` (mapping table) are what stops that upstream. | Re-apply the `GAMEPAD_*` blocks first, then assert in part A 3 / B 8 that a remote driver's `buttonsHeldCurrFrame` survives a frame. |
| R8 | **Watchdog semantics in-process.** `frames_unsynced` now measures "bridge not called", not "client process gone". | Keep it (it still catches a stuck transport loop). Network loss is detected by the transport's DISCONNECTED event, mapped to `CurrState = -1`, as upstream's `DisconSELECT` does. |
| R9 | **Public servers' version.** Public servers may have moved past 1021, or may still run 1019 / 1020. | Out of session 8's reach: session 10 connects to one public server and reads `SG_ROOMS.version`. Session 8 only keeps the version check intact. |
| R10 | **Timing of the room reset.** Upstream measures 6 s of CPU time (`clock()`, with `CLOCKS_PER_SEC_FIX` on POSIX); `sv_core.c` measures wall time. | Accept and document the difference. The trace comparison (part A 4) ignores the reset delay and checks only the message order. |
| R11 | **Host leaving.** Upstream has no host re-election (TODO in `ProcessDisconnectEvent`). In the browser, the host also runs the server, so the host leaving ends the room for everyone. | Not session 8's to fix. Documented as a known limitation; session 11 (hardening) decides whether to migrate the server. |
| R12 | **OnlineCTR's dependency on other mods.** Upstream online builds also carry other `AltMods` (e.g. the reserves bar in `BoostBar/mods5.c` has `USE_ONLINE` branches, `16BY9/mods2.c` changes `metaPhys` under `#ifndef USE_ONLINE`). | The mapping table lists them. Session 8 ports only what OnlineCTR needs for compatible races. Gameplay-affecting constants (`metaPhys`, `StatsUpgrade`) must match upstream, otherwise karts diverge from DuckStation players. |

## Session 8 findings

What implementing D1–D7 found that this audit did not say, or said
differently. The code is behind `CTR_ONLINE` (CMake) / `USE_ONLINE`.

### Where things went

| Piece | Files |
|---|---|
| Mod, upstream text | `game/OnlineCTR/` (12 files from `e3f19686`, no `debugcam.c` / `zMirrorMode.c`), included last in `game/game_unity.h` |
| Native glue of the mod | `game/OnlineCTR/native_bridge.c` (`octr` storage, `checkpointTimes`, the game-field accessors), `game/OnlineCTR/native_compat.h` (`DECOMP_` names, `FPS_DOUBLE`, `u_int`, the 8-model array) |
| Client bridge | `platform/native_online.c`, `native_online.h`, `native_online_game.h` (game fields by name), `native_online_transport.h` |
| Transports | `platform/native_online_enet.c`, `platform/native_online_loopback.c` (+ `.h`) |
| Server | `platform/online_server/sv_core.c` (+ `.h`), `sv_enet.c` (+ `.h`), `sv_enet_main.c` |
| ENet | `externals/enet/` (1.3.18, unchanged) |
| Tests | `tests/online/` (standalone CMake project, see its `CMakeLists.txt`) ; the original server, unchanged, in `tests/online/upstream/` |

The bridge talks to the game only through `native_online_game.h`, so the
same file runs against the real game and against the test stub.

### The mod text

- Kept as upstream text, with every native change marked `// ctr-native:`:
  - `ThreadFunc` is a typedef here (the mod's function is `octr_ThreadFunc`);
  - renamed fields (`unk1e` → `funcState`, `unkAudioState` → `audioState`,
    `startPlusFour` → `uiOT`);
  - `UI_DrawDriverIcon` takes the position and prim memory explicitly;
  - the MIPS poke and the 8 MB mempack poke;
  - the scratchpad pointer of `names3d.c`;
  - NULL checks where the PS1 build wrote low RAM through an empty driver slot
    (`Ghostify`, `OnRaceEnd`, remote shots, overhead names, the checkpoint
    tracker on levels without restart points).
- `DECOMP_` names, `FPS_DOUBLE` and `u_int` come from `native_compat.h`, so
  most of the mod diffs cleanly against CTR-ModSDK.

### Corrections to the audit

- **D1, `MEMPACK_SIZE`**: natively, `MEMPACK_Init` ignores its size. The arena
  is fixed in `platform/native_memory.c` (`CTR_NATIVE_MEMPACK_*`). The 8 MB
  arena is set there under `USE_ONLINE`, and `MainMain.c` as well, for parity.
  `platform/native_memory.c` was outside this session's lane: the edit is one
  `#ifdef` block, and no other session owns that file.
- **R12, `StatsUpgrade`**:
  - Upstream's `struct MetaPhys` for USA retail is `{offset, size, value[5]}`,
    with value 4 = "MAX". The disc says `{debug word, offset, size, value[4]}`
    (gravity row at `0x98e0c` of `ctr-u.bin`: `0, 0x416, 2, 900, 900, 900, 900`),
    which is ctr-native's layout.
  - Upstream rebuilds both the table and its readers with its own layout, so
    online karts get the MAX column on stats 9–12: 544, 1152, 13900, 15400.
  - That is the largest class value of each row, so the port copies the
    maximum (`hooks.c`).
- **Required mods the audit counted as optional**: upstream's `common.h` turns
  on more mods under `USE_ONLINE`. Two of them change what a compatible race
  needs.
  - `USE_DRIVERLOD`: without it, the 1P arcade MPK has the wrong 7 models.
    `LOAD_DriverMPK` loads the high-LOD models of drivers 0–6 plus the Time
    Trial MPK of driver 7. Upstream writes those models past
    `data.driverModelExtras[3]`. `struct Data` is pinned here, so they go to
    `onlineDriverModelExtras[8]`, which `VehBirth_GetModelByName`, the stage-6
    pointer fix-up and `LOAD_GlobalModelPtrs_MPK` also walk.
  - `USE_RETROFUELED`, in retro rooms: holding Square with DOWN or a landing
    boost keeps the reserves, and the fire is not resized
    (`VehPhysProc_Driving_PhysLinear`, `VehFire_Increment`).
  - `USE_BIGQUEUE` is not needed: load stage 4 queues exactly 8 files.
  - `USE_BOOSTBAR` and `USE_16BY9` are visual only. They were not ported.
- **R7**:
  - Natively, `GAMEPAD_ProcessSticks` resets the sticks of every unplugged pad.
    Without the online guard, it would overwrite the remote drivers' sticks
    each frame.
  - `GAMEPAD_ProcessHold` and `ProcessSticks` start with `if (i != 0) break;`
    online, rather than upstream's break at the end of the loop body: the native
    loops have a `continue` that would skip a trailing break.
- **Bridge connection**:
  - Upstream blocks for up to 3 × 3 s in `enet_host_service`. The bridge
    connects asynchronously and checks the result once per frame.
  - After 3 failed attempts, upstream's loop fell through to `LAUNCH_PICK_ROOM`
    with no connection. The bridge sets `CurrState = -1` instead, and the game
    reopens the server menu (`thread.c`).
  - The "Private Room" entry (7) connects to `CTR_ONLINE_SERVER` (`host:port`,
    default `127.0.0.1:64001`). The player name comes from `CTR_ONLINE_NAME`.
    Both can be set with `NativeOnline_Configure()`.
- **R6**: the bridge logs one `[OnlineCTR] frame N: state S (level L, loading
  X)` line per state change and every 600 frames. Whether the `readyToSend`
  site runs every frame in the lobby is for session 8b to read in that log.
  The guarded second call (D3) was not added without that evidence.

### Upstream server behaviour the tests pinned

- **Uninitialised padding.** `SG_ROOMS`, and the empty `SG_NAME` sent when a
  player disconnects, are built in uninitialised structs. The 4 bits after
  `type` are stack garbage on the wire. No client reads them, and the trace
  comparison masks them. `sv_core.c` sends zeros.
- **Out-of-bounds room.** `CG_JOINROOM` accepts room 16 (`> 16`), which indexes
  `roomInfos[16]`. `sv_core.c` rejects it.
- **Room-list peers.** A peer that leaves from the room list stays in the
  room-list peer list until its ENet slot is reused. `sv_core.c` removes it.
- **Room reset delay (R10).** The reset happens 6 s of CPU time after the race
  ends. In the test, that took **31 s** of wall time against the original
  server, and 6.0 s against `sv_core.c`.
- **64-bit (R4).** The original server builds on aarch64 64-bit unchanged.
  The pointer → `unsigned int` casts only compute a room index from two
  pointers into the same array, so truncating them is harmless. No test patch
  was needed.
- **Bitfields (R5).** Every `CG_*` / `SG_*` struct packs to the same bytes
  under GCC 12 (aarch64) and Emscripten 6.0.13 (wasm32). Those bytes match a
  hand-derived LSB-first layout. This holds for this tree's `global.h` and for
  upstream's.

### Not ported (visual only)

- Online speedometer redesign (`UI_DrawSpeedNeedle`, `UI_DrawSpeedBG`,
  `UI_JumpMeter_Draw` gradient, slide-meter offsets).
- Map moved up and shown together with the speedometer (`UI_Map_DrawRawIcon`
  `posY -= 50`, `mapPosY = 145`).
- `WIDE_PICK` HUD offset.
- BoostBar online bar.
- Mirror mode (D2).
- The byte-budget `#ifndef USE_ONLINE` around function definitions and
  includes (`WindowBoxLines`, `UI_AAA_BigBlock1.c`).

`UI_DrawLapCount` needed no change: 1P already formats the lap count with
`sprintf`.

### Reading the mapping table after session 8

The mapping table above is session 7's survey, written before the code.
Its "Today" cells and line numbers have drifted, and some R rows still read
as work to do. Use `grep -n USE_ONLINE` on the cited file instead. Known
drift:
- The crate rows (`RB_CrateWeapon_LInC`, `RB_CrateFruit_LInC`,
  `RB_CrateTime_LInC`): the online checks are in the sibling `*_ThCollide`
  functions, where ctr-native moved the logic.
- `VehBirth_EngineAudio_AllPlayers` ends with `return`, not `break`.
- `PlayLevel_UpdateLapStats`: online, `HANDLE_NULL_DRIVER` is `continue`
  (`break` otherwise). ctr-native already uses `continue` in every per-driver
  loop. Online also skips empty slots in the rank loop, as upstream does.
- `PROC_CollidePointWithBucket`: `mods2.c` keeps upstream's `short *`
  signature, and `PROC.c` casts the `struct BucketSearchParams *` into it.
- `UI_DrawRankedDrivers` reads `octr` directly. `OnlineGetNumDrivers()` is
  called from `UI_BattleDrawHeadArrows` only.
- The `sv_core.c` `CG_NAME` log line drops the joiner's IP. That line is
  operator logging only.

### Single-player build unchanged

With `CTR_ONLINE=OFF`, the unity translation unit (`main.c`) preprocesses to
the same C token stream as before these changes. Line breaks and `__LINE__`
inside `assert` are excluded from the comparison.

## Session 9 findings

The browser transport and the host's server, behind `CTR_ONLINE` on
Emscripten. Files: `platform/web_online_transport.{c,h}`, `web/online/`
(`library.js` is the `--js-library`, `net.js` the JS queue, `page.js` the
panel), `tests/online/web_client.c`, `web/online/test/`.

### How the pieces meet

- **Configure.** Nothing in `game/` or `main.c` knows the browser: a
  constructor in `web_online_transport.c` calls
  `NativeOnline_Configure(&WebOnline_Transport, NULL, "room-link")` before
  `main()`, and loads `web/online/page.js` (dynamic `import()` from the
  library) when there is a document. `index.html` is unchanged; the CMake
  `CTR_ONLINE` block copies `web/online/*.js` and `web/net/*.js` next to it.
- **Server menu.** Entries 0–6 are refused by `connect()` (returns -1, one
  log line). The bridge's three attempts then fail in three frames and the
  game reopens the server menu. Entry 7 ("Private Room") is the page's room.
  With no room yet, it is refused the same way. Role (host / guest) and the
  player name are read from the page at `connect()` time.
- **Guest.** `connect()` → the page's `room.connect()`; `CONNECTED`,
  `DATA` and `DISCONNECTED` come back through the JS queue. The bridge gives
  up an attempt after 3 s and retries. The JS side keeps the first
  `room.connect()` in flight, and a retry waits for that same link. The page
  opens guest rooms with `rtcTimeoutMs: 5000`, so a failed WebRTC attempt
  falls back to the relay inside the bridge's 3 × 3 s.
- **Host (D4).** At the first `connect()` as host: `SvCore_Init(
  NativeOnlineLoopback_Wrap(webCoreHost))`, then the loopback backend.
  - `webCoreHost.send` / `kick` are synchronous calls into JS.
  - `setTimeout` is NULL: a dead guest is its link closing (WebRTC failed,
    WebSocket bye, the relay's peer list), not an ENet idle timer.
  - Kick closes the link and raises no event, as `enet_peer_disconnect_now`
    does.
- **Peer ids and address key.**
  - Each guest link gets the lowest free int id from 0. The loopback id 259
    is never reached: the relay caps a room at 8.
  - The address key is FNV-1a 64 of the guest's room peer id, so a
    reconnecting guest keeps its key.
  - A link the room replaces (a WebRTC re-offer) is `DISCONNECTED` under its
    old id, then `CONNECTED` under a new one.
- **Tick site.** The host's `poll()` services the server once per bridge
  frame, gated on `NativeOnline_FrameCount()`: drain the JS queue into
  `SvCore_Connect` / `Receive` / `Disconnect`, then `SvCore_Tick(now)`. That
  is the start of `ProcessNewMessages`, inside `NativeOnline_Frame()`, so the
  server runs exactly when the host's bridge runs (R6 below). While the
  host's own client is not connected (it pressed SELECT, back on the server
  menu), the server is not serviced. Guests' messages wait in the JS queue,
  and their room is frozen until the host picks Private Room again.
  Hardening this is session 11's.
- **Page (the user's choices).** An « Online » sidebar on the right of the
  4:3 canvas (`page.js`).
  - **Layout**: the page makes room for the sidebar, which covers the game's
    edge only in a narrow window. Closed, it is a round button that is
    invisible while the mouse rests, brightens as the mouse approaches, and
    opens the sidebar on click.
  - **Language**: English or French, following the browser.
  - **Host**: the *meeting points* of the new room, in order (our relay,
    with its address and key ; public brokers ; copy-paste code). Each has a
    one-line explanation, and only the relay can also carry the game.
  - **Guest**: the *connection* (automatic : direct, else via the relay ;
    or always via the relay).
  - **Copy-paste**: the codes to exchange are shown in the sidebar.
  - **Status**: each link's path in plain words (« direct (IPv6) »,
    « via the relay ») and where the players met.
  - **Pre-connect**: a guest starts its link to the host as soon as the room
    opens, which a copy-paste exchange needs. What the host sends before the
    game picks Private Room waits behind the `CONNECTED` event.
  - `relay` / `rk` are taken out of the shared link's query.
  - **Debug getter**: `window.__ctrOnline.state()`, with octr, links,
    per-slot kart samples and message counts by OnlineCTR type. Never
    `window.__ctr`.
- **Channels (D7).** `reliable` → `ctl`, else `game` (the code's name for
  D7's `race`). The WebSocket link carries both through the relay. The link
  API does not say which channel a message came in on, so a received
  message's reliability is not known to the wasm (only the tests need it).

### Live check (session 8's B8), two windows of the test Chromium

Room → lobby → track and laps → characters → loading → race. Both karts move
on both screens: over WebRTC (`direct-ipv6`), and with the guest forced onto
the relay (WebSocket). These answer the open risks:

- **R6.** Bridge calls per second, from `octr.windowsClientSync` sampled by
  the page, measured on both sides:
  - about 30/s in every lobby state (server menu, room list, track pick,
    track wait, character pick);
  - 27.8–27.9/s during the fly-in and 29.8–29.9/s in the race;
  - about 3.5/s during `LOBBY_START_LOADING` only. That is the loading screen
    itself: the game frame blocks on sector reads.

  The lobby never misses a frame, and loading completes into the race on
  both sides. The guarded second call at the top of `MainFrame_GameLogic` is
  therefore not added. The server ticks at the same rate (tick site above).
  During loading, its 6 s room reset and its broadcasts wait at most one
  slow frame.
- **R7.** In the real game, the host samples the guest's driver slot at its
  bridge's first poll of a frame, which is after the game's own pad polling.
  24 of 25 samples still hold the guest's Cross. The miss is the sample taken
  at the release.
- **R2** (an 8-driver race in the 8 MB arena) needs 8 browsers. It is
  deferred to TEST-PLAN-9.

### Measured limits for session 11

- **Relay rate.** `ctr-relay` allows 120 messages/s per socket by default
  (`RELAY_RATE`). It drops the excess, closing only after 240 drops in a row,
  and that drop can hit reliable control messages too.
  - At 30 fps, a host whose guests are all on the relay sends
    (N − 1)² × 30 `SG_RACEDATA` per second: 120/s with 3 players, 1470/s
    with 8.
  - Three players are at the default limit. More players on the WebSocket
    path need a higher `RELAY_RATE` on that relay, or fewer, coalesced
    sends.
- **Backlog.** The headless clients run at about 500 frames/s. At that rate,
  the WebSocket path (sealed one message at a time) queued seconds of kart
  states ahead of a weapon message. At the game's 30 fps it keeps up. A
  sender that floods a reliable path delays its control messages: unordered
  `game` exists for exactly that.
