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

Session 9's notes, kept as they were measured then ; session 11 re-measured them on the
one build of session 14 and changed what follows (« Session 11 findings » at the end).

- **Relay rate.** `ctr-relay` allowed 120 messages/s per socket by default
  (`RELAY_RATE`) and dropped the excess, reliable control messages included.
  Session 9 counted (N − 1)² × 30 `SG_RACEDATA` per second at the host ; the
  server also echoes each kart state to its sender (upstream's broadcast), so it
  was N × (N − 1) × 30 : already 172/s with 3 players. Session 11 : coalesced
  sends and a 300/s default (below).
- **Backlog.** The headless clients run at about 500 frames/s. At that rate,
  the WebSocket path (sealed one message at a time) queued seconds of kart
  states ahead of a weapon message. At the game's 30 fps it keeps up. A
  sender that floods a reliable path delays its control messages: unordered
  `game` exists for exactly that.

## Session 14 findings

One build for solo and Online: the map of what `USE_ONLINE` changes at
compile time today, and of the game's own multiplayer flow, written before
the design (the decisions are D8–D10 below).

### How the upstream mod enters the online flow

The mod is online-only from boot. Every step is compile-time:

| Step | Where | What it does |
|---|---|---|
| Boot init | `game/MAIN/MainMain.c:509` `StateZero` → `octr_entryHook()` (`game/OnlineCTR/hooks.c:33`) | `StatsUpgrade()` overwrites `data.metaPhys[9..12]` for every class, permanently ; drops the cutscene models (`MetaDataModels[0x96..0xa5].LInB = 0`) ; zeroes `octr`, sets `IsBootedPS1` and `ver_psx` |
| Boot level | `MainMain.c:627` | `gGT->levelID = INTRO_OXIDE` (0x26, the globe) instead of `NAUGHTY_DOG_CRATE` : no intro cutscene |
| Intro audio | `MainMain.c:661` (`#ifndef`) | `Music_SetIntro`, the SCEA XA and its wait loop are compiled out |
| Arena | `MainMain.c:519`, `platform/native_memory.c` | 8 MB mempack (RAMEX) |
| Level init | `game/MAIN/MainInit.c:481` | `OnlineInit_Drivers()` (`hooks.c:84`) instead of `MainInit_Drivers()` : 8 spawn slots, remote drivers born as humans from `octr->nameBuffer`, `CurrState = GAME_WAIT_FOR_RACE` on a race level |
| Level init, end | `MainInit.c:646` | `octr_initHook()` births the mod thread (`octr_ThreadFunc`, `thread.c:29`) and **returns early** : the cutscene freecam and confetti init below are skipped |
| Per frame | `thread.c:29` `octr_ThreadFunc` | runs `StatePS1_<CurrState>` (`states.c`) : the server / room / track / laps / character RectMenus on the globe, « waiting for host », « LOADING... », then in-race : ghostify, remote weapon replay, names, end of race. The watchdog resets to the server menu when the bridge stops being called, and on `CurrState < 0` it reloads level 0x26 |
| Per frame | `game/MAIN/MainFrame.c:357` `NativeOnline_Frame()` (`platform/native_online.c:811`) | the client state machine : `StatePC_Launch_PickServer` connects when `serverLockIn1` is set **and `levelID == 0x26`** (`native_online.c:506`) ; `PickRoom` joins when `serverLockIn2` ; `HostTrackPick` sends `CG_TRACK` when `boolLockedInLap` ; `CharacterPick` sends `data.characterIDs[0]` + `boolLockedInCharacters[DriverID]` ; `SG_STARTLOADING` → `StatePS1_Lobby_StartLoading` requests the level load with `gameMode1 = LOADING | ARCADE_MODE` (`states.c:263`) |
| Browser | `web/online/library.js` `ctrOnlinePickPrivateRoom`, polled by `page.js` | session 9 : once the page has a room, pokes `serverCountry = 7`, `serverLockIn1 = 1` into octr, so the game goes from boot to the room list |

The lobby → race sequence the mod expects, with who writes each `octr`
field today (the game's RectMenus) and what the new flow must write instead :

```
 page room ──► serverCountry=7, serverLockIn1 ──► bridge connects (host: loopback+sv_core ; guest: web link)
            ──► serverRoom=N, serverLockIn2    ──► CG_JOINROOM ──► SG_NEWCLIENT (DriverID, NumDrivers) ──► LOBBY_ASSIGN_ROLE
 host : levelID, lapID, boolLockedInLevel+Lap  ──► CG_TRACK   ──► SG_TRACK to all ──► LOBBY_CHARACTER_PICK
 each : data.characterIDs[0], boolLockedInCharacters[DriverID] ──► CG_CHARACTER ──► SG_CHARACTER to all (characterIDs[slot])
 server: all locked ──► SG_STARTLOADING ──► StatePS1_Lobby_StartLoading loads octr->levelID ──► OnlineInit_Drivers ──► race
```

### Every `USE_ONLINE` site, by what it does to single player

95 blocks in 41 files (`grep -rc USE_ONLINE game platform include`).
**Gate** = changes single-player behaviour when compiled in, so it must
become a runtime test ; **keep** = harmless with online inactive, stays
compile-time (sizes, layouts, online-only fields that stay 0).

| File | Blocks | What the online text does | Class |
|---|---|---|---|
| `MAIN/MainMain.c` | :509 entry hook · :519 8 MB · :627 boot level · :661 intro | boot into the mod ; no intro | gate :509 (its permanent effects move to activation), :627, :661 ; keep :519 |
| `MAIN/MainInit.c` | :242, :260, :266 pools · :481 drivers · :646 init hook | 8-driver pools ; online driver birth ; early return skips cutscene / confetti init | gate :481, :646 ; keep pools |
| `MAIN/MainFrame.c` | :146 + :192 clock loop on `drivers[0]` only · :313 hazard sync · :346 `RunVehicleThread` · :357 bridge call | P1-only clock, checkpoint tracker per driver stage, hazards frozen while `trafficLightsTimer > 3600` | gate all (the bridge call returns at once when inactive) |
| `MAIN/MainFrame_RenderFrame.c` | :158 split-screen lines · :529 crystal challenge UI · :538 `OnlineEndOfRace` + return · :613 adventure hub UI | no split lines, no adventure HUD, online results screen | gate all |
| `MAIN/MainGameStart.c` | :34 | `VehBirth_TeleportAll` skipped at race start | gate |
| `GAMEPAD.c` | :139, :245 one pad · :343, :566, :808 break after P1 | only P1 polled : couch mode dead, pad 2 never plugged | gate all |
| `LOAD/LOAD_Assets.c` | :67 `LOAD_Robots1P` return · :103 `LOAD_DriverMPK` | no bot characters ; 8 high-LOD models always | gate both |
| `LOAD/LOAD_TenStages.c` | :329 region 3 for 0x26 · :428, :524 model extras | only on the globe ; extra arrays | keep |
| `LOAD/LOAD_ModelPtrs.c` | :25 | extra model pointers | keep |
| `BOTS.c` | :3924 `BOTS_Driver_Convert` return | **no AI driver ever** (1P arcade, demo, end of race) | gate |
| `PlayLevel.c` | :64, :125, :145, :180, :216, :317, :325, :401, :409, :472 | `farthestHuman = drivers[0]` ; online lap times ; final-lap text and confetti for `driverID == 0` only ; rank holes ; **race ends when `drivers[0]` finishes** | gate all |
| `Vehicle/VehPhysProc.c` | :251 uncapped reserves · :832, :846 shoot flag · :976 reserves cut · :1079 assume Cross · :1685 audio · :2541 meter grade · :2587 echo · :2935 voice | P1-only sound, reserve rules of online rooms | gate all (:832 / :846 / :251 read `octr` ; gating keeps them off) |
| `Vehicle/VehStuckProc.c` | :436, :482, :840, :1034, :1114, :1339 | camera / sound for `driverID == 0` only | gate all |
| `Vehicle/VehFire.c` | :45, :307, :330, :368, :382, :400 | P1-only audio, retro-fueled, `FixReservesIncrement` | gate all |
| `Vehicle/VehBirth.c` | :67 start-line spawn · :481 camera for P1 only · :609 extra models · :727, :736 engine audio P1 only | adventure key spawn lost ; **2P split screen gets one camera** | gate :67, :481, :727 ; keep :609 |
| `Vehicle/VehPickupItem.c` | :247, :289, :316 mask sounds · :619 shoot | `driverID == 0` instead of « not a bot » | gate all |
| `Vehicle/VehPickState.c` :310 · `VehPhysGeneral.c` :1694 | attack pick, item set by room | gate both |
| `UI/UI_Rank.c` | :137, :164, :198, :216, :252 | online rank column with names and checkpoint times | gate all |
| `UI/UI_RenderFrame.c` | :133, :471, :555, :772 | HUD for `drivers[0]` only, no position suffix, no ghosts on the map | gate all |
| `UI/UI_Instance.c` | :62, :230, :399, :410 | one HUD, no BIG1 / CTR letters | gate all |
| `UI/UI_RaceHud.c` | :105, :115, :209 | head arrows by `octr->NumDrivers` | gate all |
| `UI/UI_Icon.c` :282, :313 · `UI_Map.c` :275 · `UI_Lerp2D.c` :18 · `UI_DrawSlideMeter.c` :46 · `UI_Clock.c` :224 | 8-icon clip, player test, rank swing, meter grade, clock format | gate all |
| `HOWL/HOWL_AudioState.c` | :200, :252, :298, :377, :421 | music follows `drivers[0]` | gate all |
| `HOWL/HOWL_OtherFXRecycle.c` | :5 | **mutes every sound that is not P1's** | gate |
| `231/RB_Crate.c` | :196, :333, :359, :493 | only `driverID == 0` picks crates : **bots and P2 cannot** | gate all |
| `231/RB_Player.c` :188 · `RB_Follower.c` :95 · `RB_MaskShieldCloud.c` :432 | P1-only wumpa / follower / voice | gate all |
| `PROC.c` | :340 | `Online_CollidePointWithBucket` : **no kart collision at all** unless the room has items (`serverRoom` is 0 when inactive) | gate |
| `CAM.c` | :537 | fly-in for camera 0 only | gate |
| `DecalFont.c` | :69 | flag mask `0x7ff` (post-retail bug fix) | gate |
| `zGlobal_DATA.c` | :8166, :8201, :8234 | the online item odds replace the retail tables in `data` (pinned layout, `include/regionsEXE.h:2221`) | gate : the online tables become a second array picked at runtime where `VEH_ITEM_SET_RACE*` is read |
| `include/namespace_Vehicle.h` :1 · `platform/native_memory.c` :1 · `game/game_unity.h` :2 · `CMakeLists.txt` :2 | struct fields, arena, includes | keep |

So about 75 blocks in 32 files need a runtime test ; the rest (sizes,
layouts, extra model arrays) stay compile-time. Three
of the gated ones are not « P1 only » tweaks but outright breakage of the
OFF behaviour : no AI drivers (`BOTS.c`), no kart collision (`PROC.c`), no
sound but P1's (`HOWL_OtherFXRecycle.c`).

Inside the mod : `thread.c` reloads level 0x26 on disconnect (`:104`) and
`states.c` draws the lobby menus and text in every lobby state ;
`StatePS1_Lobby_StartLoading` is the one lobby state with a side effect the
new flow still needs (the level load, `states.c:235-274`).

### The game's own multiplayer flow (retail, the lobby to reuse)

- **Main menu is P1 only** : `MM_MenuProc_Main` sets `numPlyrNextGame = 1`
  (`game/230/MM_MenuFlow.c:84-86`) and `RECTMENU_ProcessInput` reads
  `buttonTapPerPlayer[0]` unless the menu has `ALL_PLAYERS_USE_MENU`
  (`game/RECTMENU.c:636-643`, used by the pause menus only).
- **Player count** : VS → race type → `menuPlayers2P3P4P` ; a row is locked
  unless pads `0..n-1` are plugged (`MM_ToggleRows_PlayerCount`,
  `MM_MenuFlow.c:285-317` ; `MainFrame_HaveAllPads`, `MainFrame.c:582-610`).
  `MM_MenuProc_2p3p4p` sets `numPlyrNextGame = row + 2` and exits the title
  to the character select (`:362-404`). A remote pad plugged by the page
  (Share's `slots.read`, `web/share/slots.js:71-84` →
  `NativeInput_ApplyRemotePads`, `platform/native_input.c:271-317`) opens
  those rows : that is how session 19's bot plays P2.
- **Character select** : each player `< numPlyrNextGame` drives its own
  cursor from `buttonTapPerPlayer[playerIndex]`, locks with Cross (bit
  `1 << playerIndex` in `sdata->characterSelectFlags`), the screen exits when
  all have locked and writes `data.characterIDs[0..3]`
  (`game/230/MM_Characters.c:996-1299`, `:1379-1397`).
- **Track and laps** : P1 only (`game/230/MM_TrackSelect.c:623`, the lap
  box through `RECTMENU_ProcessInput`) ; `gGT->currLEV` and `gGT->numLaps`.
- **The load** : `QueueLoadTrack_MenuProc` (`game/QueueLoadTrack.c:30`) is
  the single site that turns the menus into a race :
  `MainRaceTrack_RequestLoad(gGT->currLEV)`. `LOAD_TenStages` copies
  `numPlyrNextGame` into `numPlyrCurrGame` (`:125-128`), `MainInit_Drivers`
  births one human per `numPlyrCurrGame` (`MainInit.c:327-330`), pad `i`
  drives driver `i`, bots only in 1P / 2P Arcade and Adventure (`:333-379`).
- **End of a VS race** : `PlayLevel.c:467-535` → `MainGameEnd_Initialize` ;
  the VS menu (RETRY / CHANGE LEVEL / CHANGE CHARACTER / QUIT, `game/225.c:501`)
  is P1 only ; QUIT and the CHANGE rows set `sdata->mainMenuState` and
  `MainRaceTrack_RequestLoad(MAIN_MENU_LEVEL)` (`game/UI/UI_RaceFlow.c:324-396`) ;
  `MAIN_MENU_LEVEL` is 0x27 (`include/namespace_Level.h:45`), the jump
  into the right menu happens in `LOAD_TenStages.c:380-414`.
- **Share's host already runs this flow with remote pads** : guests' pads
  are P2–P4 (`web/share/host.js`, `slots.js`), the host's canvas and audio
  are streamed over the room link's own WebRTC connection (`media.js`), and
  the Share bot (`web/share/bot.sh`) browses and locks a character from the
  host's `charSelect` broadcast (`TAG.kart`, `protocol.js`).
- **Online's race already runs with the local player as `drivers[0]`** :
  `OnlineInit_Drivers` maps `octr` slots (`clientID + 1` below `DriverID`,
  `clientID` above) to drivers 1–7 ; `numPlyrCurrGame` stays 1 (one camera,
  one HUD).

### The page (facts the share code and the no-disc landing build on)

- A room link is `<base>#room=<11 chars>&key=<43 chars>[&sig=…][&relay=wss://…][&rk=…]`
  (`web/net/link.js:1-30`) : room id = 8 random bytes base64url, secret = 32
  random bytes base64url, HKDF-SHA256 keys from (secret, room id)
  (`web/net/crypto.js:34-42`). The relay URL and its access key travel in the
  link ; the relay sees the room id and `rk`, never the secret.
- Online's link is the game page itself (`index.html#room=…`, `page.js:345`),
  Share's guest link is `share/guest.html#…` (`panel.js:116`). Nothing in a
  link says which mode it is.
- A guest opening the Online link without stored game data sees the plain
  drop zone (`web/ui/src/Boot.svelte`) ; `online/page.js` only runs once the
  game boots (`library.js:50`), so the room in the hash is invisible until then.
- There is no short code anywhere.
- The ON build is served at `/online/` by the published site, the OFF build at
  `/` (`web/pages/assemble.sh:42-51`) ; `index.html` is the same file in both.

### D8 — One build : the mod is on at runtime

`USE_ONLINE` stays the compile-time flag of the mod's text ; what used to
be « the ON build is online-only » became two runtime tests, defined in
`game/OnlineCTR/native_compat.h` and stored in `native_bridge.c` :

- `ONLINE_ROOM` (`octrActive`) — a room is joined. Gates the bridge's state
  machine (`NativeOnline_Frame` returns at once otherwise), the main menu's
  ONLINE sub-menu, and the attract demo (a room never starts it).
- `ONLINE_RACE` (`octrActive && octr->CurrState >= LOBBY_START_LOADING &&
  !(gameMode1 & MAIN_MENU)`) — this level is, or is being loaded as, the
  room's race : true from the load's first stage (which clears `MAIN_MENU`),
  false on the menu level that waits for `SG_STARTLOADING` and keeps
  rendering under the flag — the lobby's level is never the race. Every in-race and
  load-time block of the map above tests it : driver birth, pads, HUD,
  audio, items, crates, collision, bots, lap stats, the end of race. The
  lobby runs the retail menus with retail pads ; the main menu loaded after a
  race (`CurrState` back to `LOBBY_ASSIGN_ROLE`) is retail again.

Every edit is marked `// ctr-native: one build, runtime` inside the existing
`#ifdef USE_ONLINE`, and the retail text keeps its tokens : the OFF build
preprocesses to the same translation unit as before (`off-identical.sh`).
The item odds of the online rooms left `struct Data` (pinned layout) for
`onlineItemSetRace2/3/4[]`, picked at `VehPhysGeneral_SetHeldItem`.

The mod's boot init moved to `OnlineRuntime_Activate()` : `octr` zeroed,
`IsBootedPS1`, `ver_psx`, the rewards and the save's unlocks opened (saved,
restored on leave : the retail menus test `GAME_PROGRESS.unlocks`, not the
hub's `advProgress.rewards`, so the room's players pick any character and
track in the game's own menus), the
mod thread born on the current level (it kills itself once the room is left ;
`octr_initHook` births it on every level of a room). `StatsUpgrade()` is
applied around the room's race only (`OnlineRuntime_SyncStats`), so solo play
beside an open room keeps the retail stats ; the cutscene-model drop is not
done at runtime (the 8 MB arena holds them, a leave must keep the cutscenes).
`OnlineRuntime_Deactivate()` undoes all of it and, from a race level, loads
the title.

Natively nothing changes in spirit : `octrBootOnline` (default 1 ; the web
constructor sets 0) keeps the boot into the globe and the mod's own menus
(`octr_entryHook` sets `octrActive`). One difference : the globe level now
gets the retail cutscene init, the early return of `MainInit_FinalizeInit`
being `ONLINE_RACE`-gated. The i686 build is still compile + ctest only.

The host layer talks to the game through `native_online_game.h` :
`NativeOnlineGame_Activate / Deactivate / Active / SyncStats / SetMode /
SetMyCharacter`, stubbed in `tests/online` (always on, as the native flow).
The bridge polls a control queue once per frame (`NativeOnline_SetControl`,
`enum NativeOnlineControl` : ENTER, LEAVE, CHARACTER) ; the web transport
registers `ctr_web_online_control` (D6 kept : JS only queues). ENTER waits
until the game is on its title between loads, then picks « Private Room »
(`serverCountry = 7`, `serverLockIn1`) ; the page's
`ctrOnlinePickPrivateRoom` poke of session 9 is gone.

### D9 — The lobby is the game's own menus, shared

With `octrExternalLobby` (set by the web constructor), the mod's lobby states
draw nothing : `thread.c` dispatches `LAUNCH_*` / `LOBBY_*` to
`OnlineExternal_State()` (`native_bridge.c`), which only does what the
protocol needs — the join of room 5 (the items room ; one room per link ;
no `ResetPsxGlobals` : the mempack end is the arena's already, `SG_NEWCLIENT`
clears the locks, and the characters belong to the host's menus), the role
assignment (and,
after a race, the reload of the title : the room stays, the room reset sends
everyone to `LOBBY_ASSIGN_ROLE` on the race level), and the level load of
`LOBBY_START_LOADING` without its text (the menu's battle limits kept ; the
active menu closed directly, as upstream's guest state does — a guest has no
track lock to hide the menu its game sits in, and a menu left active draws
over the race and takes the pad). The race states are upstream's. `StatePC_Launch_PickServer`'s « level 0x26 »
test is skipped on the web.

The host plays the lobby in the game : the main menu's new row ONLINE
(`game/230/MM_MenuFlow.c`, `ONLINE_LNG_ROW` = language slot 0x9a, as the
mod's menus use 0x9a–0xa1) opens the page's multiplayer panel when no room
is joined (`NativeWeb_OpenMultiplayer`, CTR_ONLINE web builds only ; a solo
boot keeps the panel closed, as the OFF build had none — a room link opens
it), else a
VS / BATTLE sub-menu whose rows take the retail paths (players, characters,
track) with `octrOnlineMenuPath` set. The guests' pads are P2–P4 through
Share's host on the same room (`web/share/panel.js` `startOn`, guests on the
relay kept with their pad and no picture), so the player-count rows open as
in couch play. At the track lock, `QueueLoadTrack_MenuProc` calls
`OnlineLobby_RequestRace()` : in `LOBBY_HOST_TRACK_PICK` it writes
`octr->levelID`, `lapID`, the locks, the host's own character lock,
`numPlyrNextGame = 1`, and snapshots the menus' `data.characterIDs[1..3]`
for the page (`octrLobbyCharacters`, `octrLobbyPhase = STARTING`) ; the
bridge sends `CG_TRACK`, then `CG_CHARACTER`. The page sends each guest the
character its pad locked (Share's `LOBBY` message, tag 0x19) ; the guest's
`OnlineLobby_SetMyCharacter()` writes `data.characterIDs[0]` and its lock,
its bridge sends `CG_CHARACTER`, and `SG_STARTLOADING` loads every game's
own race — the existing part. The guest's game, meanwhile, sat on its title
(or wherever its menus were) with its local input blocked from the join to
the race load (`ctrUI.lobby`), the host's screen over its
canvas (`web/online/page.js`, a `<video>` fed by `createShareGuest` on the
game's own link) and its keys and pad sent as a Share guest's pad.

On the wire the two protocols share the links : every OnlineCTR packet
travels behind the tag byte 0x20 (`web/online/net.js` `ONLINE_TAG`), Share's
messages keep their tags (0x01, 0x10–0x19). Session 10's gateway strips the
tag. A load away from the room's race (the pause menu's quit or retry) leaves
the room (`MainRaceTrack_RequestLoad` → `OnlineRuntime_LeaveRace`) ; the
others see the empty `SG_NAME` of a disconnect, as upstream. Four players at
most : the game's menus stop there (the Share host refuses a fourth guest).

### D10 — One code for any mode (session 14c)

Settled with the user (2026-10-23), built in 14c : the share code is the
secret — 16 Crockford base32 characters (no I, L, O, U ; case-insensitive) in
four groups, `K7PX-M2QD-9RTF-H3WB`, 80 random bits ; the room id is derived
from it (a hash), so the relay still never sees the secret ; the link is
`<site>/#c=<code>` plus `relay=` / `rk=` when they are not the page's
defaults. The relay URL and key come from the page's settings (the first link
received, or the site's defaults). Joining by code : a field on the boot
screen and in the panel ; a guest without game data lands in Share.

Superseded for Netplay rooms by D13 (session 28) : the code is a few of the
game's characters, picked on dials in the game.

## Session 11 findings

Hardening of our own Online mode (session 11 ; smoothing, rejoin and the end-of-race
timeout are session 11b's). Measured on two agent browsers with the test-only impairment
shim (`web/net/test/impair.js`) and the debug build's remote-kart counter (`window.__ctr.net`,
`platform/web_debug_bridge.c`), and in node with wasm clients through a real relay
(`web/online/test/relay-load.test.mjs`). Nothing here changes the wire : no new `CG_*` /
`SG_*`, `VERSION` 1021, every OnlineCTR payload still reaches the other side's bridge on
its own ; `sv_core.c` is unchanged.

| Item | Before | After |
|---|---|---|
| 4 players, all guests on the relay | 126 of 144 weapons lost, host 352 msg/s | 0 lost, host 86 msg/s |
| 8 players on the relay | the race never starts (`SG_STARTRACE` dropped) | 0 lost, host 203 msg/s |
| A guest's page goes silent (link left open) | not noticed after 45 s (P2P and WS) | dropped after 5.1 s, the race goes on |
| The host leaves | the guest on its title, no word | « The host left the room. Your game is back to solo. » within ~2 s |
| The host on its pause menu | the room frozen : 0 kart states | the guests keep ~30 kart states / s |
| The host's tab hidden (agent browser, no throttling) | 24–30 / s | unchanged |

**Relay rate (`web/net/transport.js`, `relay/relay.js`).** The WebSocket link coalesces what
it is given within one JS task — the host's server fans every kart state out to every guest
in one game frame — into one sealed relay message, split again on the other side before any
`message` event. Only towards a peer that announced it reads batches (a bit in its `join`
frame), so an older page still gets one payload per message. This is our own framing inside
the sealed envelope : the relay forwards ciphertext as before, and the « one payload per
transport message » rule of D5 is about what reaches the bridge, which session 10's gateway
sees as ENet payloads. A relay message carrying only unreliable payloads is flagged `lossy`
(one bit the relay can see) : under load the relay drops those, and lets anything else borrow
one more burst before closing the socket with 4429, which the page reports. Defaults
300 / s, burst 600 : N players on the relay cost the host (N − 1) × 30 messages / s, 210 with
8 (TEST-PLAN-9 row 3, session 23).

**A vanished peer (`web/online/net.js`, `platform/web_online_transport.c`).** Upstream drops a
silent ENet peer after `enet_peer_timeout` : 2 s from connect, 5 s once in a room
(`sv_core.c` `SetTimeout`). The web adapter now implements `SvCoreHost.setTimeout` : the page
closes a guest link silent that long, which is its `DISCONNECTED`, as upstream. Links send a
keepalive (`ctl` text on WebRTC, a sealed `alive` frame on the relay) whenever they have sent
nothing for 500 ms ; ICE consent and the relay's own pings sit below that layer and kept a
frozen peer « alive » before. A guest gives its host 5 s.

**The host leaves (`web/online/page.js`).** A guest's game already left the room on its
bridge's `DISCONNECTED` (`thread.c`, back to the title). The page now says why — the host is no
longer on the meeting point (« left ») or still is (« connection lost ») — and closes its room.
No host migration (star topology, the server is in the host's wasm).

**The host's server while the host is out of the race (`web_online_transport.c`,
`native_platform.c`, `native_online_loopback.c`).** Session 9 serviced the server from the
bridge only, which the pause menu stops calling. `WebOnline_FrameEnd()`, at the start of
`Platform_EndScene` (web ON builds), services it when the bridge did not that frame — still
from the game loop (D6). The loopback queue to the host's own client, which nobody drains
meanwhile, drops its oldest kart state when full, never a reliable message
(`tests/online/loopback_test.c`). Settings over the game only blocks local input : the game,
and so the server, keep running. A hidden tab's loop wakes on the audio clock (session 18) :
~23 server ticks / s.

**Relay `Origin` (`RELAY_ORIGINS`).** Opt-in, empty by default : a browser-only fence, the key
gates the relay.

**Still open** (rows of their own) : remote-kart smoothing, rejoin at the next lobby and an
end-of-race timeout (11b) ; ICE restart ; a second STUN server — an unreachable STUN server
stalls ICE gathering past 12 s in Chrome, the 3 s cap of `webrtc.js` bounds it.

## Session 11b findings

Remote-kart smoothing, rejoin at the next lobby, an end-of-race timeout. Measured as in
session 11 (two agent browsers, the impairment shim at 20 ms + 0–60 ms, 5 % loss, 10 %
reorder, the debug build's `window.__ctr.net`). Nothing here changes the wire : no new
`CG_*` / `SG_*`, `VERSION` 1021, golden bytes equal ; `sv_core.c` unchanged.

| Item | Before | After |
|---|---|---|
| Remote kart under jitter, WebRTC (`jerk` p95 / max, world units, each side) | 100 / 155 · 102 / 182 | 6 / 10 · 7.3 / 13 |
| Remote kart under jitter, relay | 91 / 254 · 101 / 202 | 7.6 / 25 · 5.4 / 18 |
| Remote kart, clean link | ~2 | ~2 |
| A guest cut off while the host stays | back to solo, « connection lost » | re-linked by itself in ~7.4 s (WebRTC or relay), waits on its title, joins the next lobby in its own slot |
| A player who never finishes | holds the room on the race level | the host's choice : the race ends N s after the first finisher (60 by default) |

**Smoothing (`platform/native_online.c`, `// 11b smoothing`).** Remote karts drive
themselves between packets on the received pad (`vehThread.c`), and upstream writes each
`SG_RACEDATA` pose straight into the kart : under a varying delay that is a jolt of ~100
units every packet. The bridge now keeps, per remote kart, the difference between the
received pose and the kart (angle wrapped on 12 bits), averages one frame's packets, and
closes 1 / 12 of what is left each frame ; past 512 world units or a quarter turn it still
snaps (a respawn, a mask grab). 1 / 4 left the jerk at ~25, 1 / 8 at ~10. The pose error
itself does not grow with the slower blend (p95 ~80–110 either way) : only the kart's drift
is blended, not its motion. Out of the race nothing is kept.

**Rejoin (`web/online/page.js`, `web/online/rules.js`).** A guest's link to the host lost
while the host is still on the meeting point is no longer the end : the page retries after
1, 2, 4, 8, 15, 15 s, each try a fresh room — new relay id, new sealer (`crypto.js` pins an
id's first IV prefix, so the old id would be refused) — on the same path setting (WebRTC,
else the relay ; no ICE restart, row 11c). The game re-enters the room on its own : a racing
room is locked (`SG_ROOMS` adds 8 to its count), so it sits on its title and retries every
2 s ; the page says so (toast + status line, held from the first refusal until the server
takes it) and sends no pad and no host picture meanwhile. At the next lobby the server gives
it the first free slot (its old one in the measured two-player room ; with more players,
whoever came back first takes the lowest) and Share's guest join brings the host's picture back.
No mid-race join : OnlineCTR has none.

**End-of-race timeout (`web/online/page.js`, `platform/native_online.c`,
`game/OnlineCTR/native_bridge.c`).** The host picks never / 15 / 30 / 60 / 120 s after the
first finisher (`octr.numDriversEnded`). The host's page warns every guest at the first
finish, and at the deadline tells each to end its race, both as Share `LOBBY` messages on the
lobby link (our framing, not the game's). The page passes `NATIVE_ONLINE_CTL_END_RACE` to
its game, which ends the race where the kart stands, as a crossed finish line does (the
finish flag, no item, the AI drives on) ; the game then sends an ordinary `CG_ENDRACE` and
the server resets the room as usual.

## Session 23 findings

Online Arcade with AI karts (the user, 2026-10-23 ; the choices of 2026-11-03 and 2026-11-04 in
D11). What the room, the server and the game already do, read before the design :

| Fact | Where |
|---|---|
| The server stamps every kart state, weapon and end of race with the **sender's** `clientID` : the host's client cannot speak for another slot | `sv_core.c:532`, `:554`, `:574` |
| A peer is any id below 260 with its own address key ; the duplicate check is on that key | `sv_core.h:9`, `sv_core.c:406-416` |
| A locked room refuses every join until the reset after the race ; `SG_ROOMS` counts occupied slots, `clientCount` is a high-water mark | `sv_core.c:381`, `:160-168`, `:421` |
| The server echoes kart states, weapons, names, characters and ends to their sender | `sv_core.c:118-131` |
| A disconnect mid-race marks the slot loaded / raced and broadcasts an empty `SG_NAME` ; nothing removes the kart, it holds Square and drops out of ranks, results and `HasRaceEnded` | `sv_core.c:300-316`, `native_online.c:287-307`, `hooks.c:184` |
| Only the web adapter turns a closed guest link into `SvCore_Disconnect` | `web_online_transport.c` `WebHost_Service` |
| `OnlineInit_Drivers` births every named slot as a player kart and never calls `BOTS_Adv_AdjustDifficulty` (the nav data) ; the mod itself notes AIs need it | `hooks.c:36-45`, `:83` |
| `BOTS_Driver_Convert` returns under `ONLINE_RACE` (upstream patched it to `jr ra`) ; `NativeOnlineGame_EndMyRace`'s « the AI drives on » is therefore false online | `BOTS.c:3924` |
| `BOTS_Driver_Convert` points the AI at its path's **first** nav frame : right at a finish line, wrong mid-lap | `BOTS.c` (end of the function) |
| Bots never break crates (robot cars return first) and never read pads ; `vehThread.c` wraps PLAYER-bucket karts only | `RB_Crate.c:152`, `OnlineCTR/vehThread.c` |
| Arcade bots attack the human ranked just ahead of or behind them, for `drivers[0 .. numPlyrCurrGame)` : online, the host only | `PickupBots.c:72-260` |
| A bot shot goes through `VehPickupItem_ShootNow` with `heldItemID` set, like a player's ; only `driverID == 0` fills `octr->Shoot[0]` | `PickupBots.c`, `VehPickupItem.c:619` |
| `bestLapTime` is kept for `drivers[0]` only ; a driver's course time is `elapsedEventTime` at its finish | `PlayLevel.c:127`, `VehPhysProc.c:194` |
| The race ends locally when `drivers[0]` finishes (`MainGameEnd_Initialize`) ; the level keeps running and bots keep driving | `PlayLevel.c:482` |
| Retail Arcade asks the difficulty for a single race too ; MEDIUM / HARD lock only in a Cup | `MM_MenuFlow.c` `MM_MenuProc_1p2p`, `MM_ToggleRows_Difficulty` |
| The players menu of Arcade is 1P / 2P, VS 2P–4P ; the race type's Cup is a plain row | `D230.c` `rowsPlayers1P2P`, `rowsRaceType` |
| Character short names exist : `MetaDataCharacters[id].name_LNG_short` (language strings 60–75) | `zGlobal_DATA.c:5295` |
| `OnlineLobby_RequestRace` forces `numBotsNextGame = 0` ; the room holds 4 humans (Share drives P2–P4) | `native_bridge.c:432`, `web/share/host.js:81` |

## D11 — Bots in an Online room

Settled with the user : always 8 karts (bots fill up after 1–4 humans) ; ONLINE › ARCADE with the
game's Arcade menus, single race (the Cup row greyed), the menu's difficulty ; the host owns the
bots and decides hits ; a bot is named after its character ; a leaver's kart is finished by a bot
under **the player's name**, with a toast on every screen ; bots use weapons against **every
human** ; no Battle. Nothing changes the wire : no new `CG_*` / `SG_*`, no field change, `VERSION`
1021, golden bytes equal, `sv_core.c` unchanged. Bots exist in our rooms only : public servers
(session 10) never see one.

**D11.1 — A bot is a virtual client of the host's own server.** `platform/native_online_bots.c`
wraps the host's `SvCoreHost` (inside `NativeOnlineLoopback_Wrap`) and owns peer ids 252–258,
each with its own address key. It reads every `SG_NEWCLIENT` the server sends (a peer's
`clientID`, for the bots and for the guests) and drops the rest of what goes to its own peers ;
`kick` removes the bot, `setTimeout` is moot (no link, no keepalive). Its calls into the core are
synchronous, as the loopback's :

- in `StatePC_Lobby_HostTrackPick` (ONLINE › ARCADE only), before `CG_TRACK` locks the room :
  `SvCore_Connect`, `CG_JOINROOM` 5 and `CG_NAME` for 8 − (named slots) bots ;
- after `CG_TRACK` : each bot's `CG_CHARACTER`, locked (a character is never replayed to a later
  joiner, so it must follow the guests' join) ; `SG_STARTLOADING` then needs only the humans ;
- `CG_STARTRACE` with the host's ; every frame `CG_RACEDATA` from `drivers[slot]` ; `CG_WEAPON`
  when the bot fires ; `CG_ENDRACE` (course time, best lap) the frame its finish flag turns on ;
- at the room's reset (its `SG_NEWCLIENT` after the race) the bot disconnects on the next frame,
  so the next lobby has its slots free.

Guests change nothing : a bot's `SG_NAME` / `SG_CHARACTER` births a remote kart as a human's would,
and `LOAD_DriverMPK` loads the 8 characters from `data.characterIDs`.

**D11.2 — The host ignores its own bots' echoes.** A host-bot slot mask (`octrHostBots`, game
side, written through `native_online_game.h`) makes the host's client drop `SG_RACEDATA` (pad,
pose, 11b smoothing) and `SG_WEAPON` for those slots. `SG_NAME`, `SG_CHARACTER` and `SG_ENDRACE`
are kept : they fill `nameBuffer`, `characterIDs` and `raceStats`, so the host's results list the
bots exactly as the guests' do.

**D11.3 — A bot's pad on the wire.** Remote karts drive themselves on the received pad between
packets (`vehThread.c`). A bot sends Cross held, plus Left / Right from the change of its angle
that frame. Measured on the guest with `__ctr.net` against the humans' bar (`jerk` p95 ≤
max(2 × clean, 8)).

**D11.4 — The host's game runs AI in bot slots only.** Runtime edits inside the existing
`#ifdef USE_ONLINE`, marked `// ctr-native: one build, runtime` :

- `OnlineInit_Drivers` : with any host bot, `BOTS_Adv_AdjustDifficulty()` first (the nav data,
  and `arcadeDifficulty` : the race loads with `ARCADE_MODE`), each bot slot `BOTS_Driver_Init`
  instead of a player kart, `bestLapTime` reset, the AI engine sounds as `MainInit_Drivers` ;
- `BOTS_Driver_Convert` : the gate lets host-bot slots through (the takeover) ;
- `PlayLevel.c` : `bestLapTime` for host-bot slots too ;
- `PickupBots.c` : the targets are every human of the race (not a bot, not empty), not only
  `drivers[0]` ;
- `VehPickupItem_ShootNow` : a host bot's shot fills its slot's outbox (`octrBotShoot[slot]`,
  the fields of `octr->Shoot[0]`), sent by the bots module as `CG_WEAPON` ; each guest replays it
  and its own game decides whether it hits its player, as between humans.

The camera, HUD, sound and pad gates on `driverID == 0` stay : a bot is not the local player.

**D11.5 — Characters and names.** Bots take the base characters (0–7) the humans did not lock,
in order, as `LOAD_Robots1P` fills solo Arcade. A bot's name is its character's short name
(`GAME_LANGUAGE_STRINGS[name_LNG_short]`) cut to `NAME_LEN` (9). Seen on the NTSC-U disc (the six
the humans left in the test races) : TINY, COCO, N. GIN, DINGO, POLAR, PURA — none is cut.

**D11.6 — A bot takes over a leaver's kart.** In ONLINE › ARCADE, from the race level's
`GAME_WAIT_FOR_RACE` on, a guest link that closes before its player finished is not passed to
`SvCore_Disconnect` : the bots module keeps that peer as a virtual client for its slot, sends its
`CG_STARTRACE` (harmless if it had), and the host's game converts the driver in place
(`BOTS_Driver_Convert`, then the nav frame nearest the kart instead of the first) : lap,
checkpoint and rank are kept. Guests never get the empty `SG_NAME` : the kart drives on under the
player's name, its pose from the host's AI. The page says so on every screen (Share's `LOBBY`
message carries it, our framing). After the reset the real `SvCore_Disconnect` frees the slot
(11b's rejoin then takes it at the next lobby). The page's peer ids no longer reuse a freed id,
so a new link never lands on a held peer. Limits : a silent guest is taken over at its 5 s
timeout (its kart coasts on its last pad meanwhile) ; VS and BATTLE keep the retail leave.

**D11.7 — The end of the race.** Results come from `raceStats`, bots included, on every screen.
The host's own finish ends only its race (`PlayLevel.c:482`) : the level runs on, the bots finish
and send their `CG_ENDRACE`, the server resets the room 6 s after the last one. The game's race
clock stops at the host's finish (`elapsedEventTime` does not count under `END_OF_RACE`,
`MainFrame.c`) : the bots' course times come from a clock that counts on
(`NativeOnlineGame_RaceClock`) — found live, every bot finishing after the host had the host's
time. 11b's end-of-race timeout starts at the first **human** finisher (a bot finishing first does
not cut the players short) and also ends the host's bots still racing
(`NATIVE_ONLINE_CTL_END_BOTS`, their `CG_ENDRACE` at the time on the clock). A result is kept once
per slot and never past `raceStats[8]` : a guest that finishes and leaves in the same service of
the host's server is not taken over twice.

**D11.8 — The menus.** The ONLINE sub-menu gains ARCADE as a third row (the retail
`LNG_ARCADE` string ; VS and BATTLE keep their indices). It sets `ARCADE_MODE` (and the one-lap
cheat, as retail) and opens a race type of its own : SINGLE RACE, and CUP carrying
`MENU_ROW_LOCKED` (drawn grey, Cross refused). SINGLE RACE opens a 1P–4P players menu (rows locked
per plugged pad, as the 2P–4P one), then the retail difficulty menu (all three rows : a single
race), the characters and the track. Solo Arcade keeps its own race type, 1P / 2P and Cup :
`D230.c` is not touched.

## D12 — The Netplay Cup (session 32)

Settled with the user (2026-11-04, session 32's design proposal, confirmed before the code) :
a Cup in ONLINE › ARCADE (the host's bots, as D11) **and** in ONLINE › VS (humans only), the
retail four cups, four tracks chained with no menu between them, the standings on every game,
then the character select of session 32 (the same room, players and mode). Nothing changes the
wire : no new `CG_*` / `SG_*`, `VERSION` 1021, golden bytes equal, `sv_core.c` unchanged.

**D12.1 — The room still resets after each race.** The server resets the room 6 s after the last
finisher (`sv_core.c`, `ROOM_RESET_MS`) and every client lands in `LOBBY_ASSIGN_ROLE`, as after a
single race. In a Cup in progress neither game loads the menus there : both stay on the race
level, drawing the standings (D12.4), and the host locks the next track itself — `octr->levelID`
the cup's next `data.ArcadeCups[cupID].CupTrack[trackIndex].trackID`, the laps and the players'
characters of the first lock (`octrLobbyCharacters`), as `OnlineLobby_RequestRace` does from the
menus. Its bots rejoin at that lock (D11.1) : the same humans leave the same characters free, so
the same bots, in the same order. `SG_STARTLOADING` then loads the next track on every game, as
for any race. The guests' characters come back from the page's `starting` LOBBY message as in the
lobby.

**D12.2 — The host counts.** `gGT->cup` holds the Cup on the host, as retail : `cupID`,
`trackIndex`, `points[8]` (by slot : on the host a slot is a clientID). When the results are
complete (`HasRaceEnded`) the host adds once, in finishing order (`raceStats`) : with bots the
retail table `data.cupPointsPerPosition` (9, 6, 3, 1, then 0), humans only (VS) retail's VS rule
(N − 1 for the first of N, … 0 for the last). `CUP_ANY_KIND` stays set during the host's race :
its bots get the retail Cup difficulty per track (`BOTS.c`), the guests' games run no AI.

**D12.3 — The guests get the table.** The page reads the host's Cup (`octrCup` : active, cupID,
trackIndex, points by clientID, final) and sends it in our LOBBY message (Share's framing, the
`cup` field) at each race's end ; each guest's page writes it into its game's copy, a clientID
mapped to the guest's slot (`slot = clientID + 1` below its own, its own 0) as the bridge does.

**D12.4 — The standings, on every game.** Drawn by the mod with `DecalFont` as its results list
(`endOfRaceUI.c`), not retail's `UI_CupStandings` (one local player and no local bots online :
its icons and counts would be wrong) : « CUP STANDINGS » and the race (n / 4), each named slot's
total, this race's points, best first ; after race 4 « FINAL STANDINGS ». They replace the results
once all have finished, until the next track loads ; after the last race they hold 6 s, then the
character select (session 32's after-race path), the Cup cleared.

**D12.5 — Leavers.** A guest leaving mid-Cup : its kart finishes that race on the host's AI
(D11.6, Arcade) ; at the next lock a bot fills its slot (VS : the slot stays empty). The table is
by slot : the slot's points stay with it, the row shows the slot's current name. A player who
joins between two races (the room is open during the reset) takes a free slot and its points. Session 32f :
a guest of the room who quit or lost its link mid-Cup is not let back in before the Cup ends — it
watches (D12.12) ; the bot keeps its slot until the final standings (or the host's QUIT).
The host leaving mid-Cup : every guest finishes that race alone (session 32), then the title, the
room closed — the Cup ends with it.

**D12.6 — The menus.** ONLINE › ARCADE's race type opens its CUP row (it was `MENU_ROW_LOCKED`,
D11.8) : `CUP_ANY_KIND`, then 1P–4P, the difficulty, the characters and the retail cup select.
ONLINE › VS gains a race type of its own, SINGLE RACE / CUP, before 2P–4P. The cup select's Cross
leads to the track lock (`QueueLoadTrack`) as the track select's does ; its Triangle goes back to
the characters (retail).

**D12.7 — No players menu, NETPLAY opens the room (session 32b, the user, 2026-11-05).** In a
room the number of players is the room's humans, one per machine : the host's pad and its guests'
(P2–P4, plugged while the host's menus run), counted when the character select opens
(`OnlineRoom_Humans`, `MainFrame_HaveAllPads`) and followed while it is open (session 32e, below). NETPLAY › VS → SINGLE RACE / CUP → the
characters ; NETPLAY › BATTLE → the characters, then the retail arena and setup ; NETPLAY › ARCADE
→ SINGLE RACE / CUP → the difficulty → the characters, the bots filling up to 8 (D11). The 1P–4P
menu of D11.8 and the 2P–4P step of VS and BATTLE are gone from the room's path ; solo play keeps
them. Alone in the room, VS and BATTLE are `MENU_ROW_LOCKED` (grey, Cross refused) ; ARCADE
works alone. The character select follows the room (session 32e, the user's design) :
`OnlineCharacters_Follow` (`game/230/MM_Characters.c`, before the screen reads its input) recounts
the humans each frame and, once a new count has held 3 frames, rebuilds the screen for it — the
retail layout of that count (1P, 2P, 3P, 4P ; the 4P grid orders its icons differently, so the
icon table is rebuilt), every player's hovered character and lock kept, a newcomer unlocked, a
leaver's window and driver gone ; everyone left locked, the screen goes on. A guest leaving moves
the guests above it down a slot (`web/share/slots.js` `compact`, Netplay rooms only ; each moved
guest gets a new WELCOME) and the page tells the game which slot left (`NATIVE_ONLINE_CTL_SLOT_GONE`
→ `octrSlotGone`) : P3 becomes P2 with its character and lock. VS and BATTLE left with one human
go back as Triangle does, with the page's toast « Alone in the room » (`NativeWeb_RoomAlone`). NETPLAY with no room has the page host one at once with its saved relay and key (a toast
carries the link ; with none, the game's box offers the page's Netplay settings), then opens
this menu by itself.

**D12.8 — A changed link (session 32b).** Another room's link opened in the page — the address
bar's hash (`hashchange`) or the panel's Join, which no longer reloads — leaves the current room
(as a host, its guests are told it closed ; a race of that room ends the retail way, back to the
title) and joins the new one in place, with a toast. The game enters it once on its title
(`pendingEnter`) : behind the host's picture in its menus, or waiting for its race to end (11b).
The same room's link again changes nothing. A player racing alone outside any room is not taken
out of the race : the page joins and the game enters once back on its title. Session 32e : the
guest who joined a room before keeps no ended track of it in the lobby's picture (a black screen
over the game), and the host's server hears no guest until the host's own game has its seat
(`WebHost_Service` waits for `LOBBY_ASSIGN_ROLE`) : a guest quicker than a host that just reopened
a room took DriverID 0.

**D12.9 — The Netplay pause (session 32d, the user's design, 2026-11-05).** In a room's race Start
opens the room's own pause menu (`OnlinePause_Menu`, `native_bridge.c`, returned by
`MainFreeze_GetMenuPtr` and opened by `MainFreeze_IfPressStart` when `ONLINE_RACE`) without
retail's freeze : no `PAUSE_1`, the karts, the race clock and the wire run on. This kart coasts
while it is open (`OnlinePause_MaskPad` : pad 1 neutral while the karts update, then restored for
the menu). Its rows : RESUME ; FINISH THE RACE, only for the last human still racing (every other
human's finish in the results), whose finish is faked where it stands at the bots' estimate
(`EstimateEnd`, shared with `NativeOnlineGame_EndBots`) — every human done, the host ends its bots
at once and the results come at once ; PAUSE FOR EVERYONE, the host only ; QUIT, retail's (YES :
the host's ends the room's race for everyone, 32e ; a guest's leaves the race, the room kept, D12.12 ;
NO comes back to this menu). Triangle, Start and RESUME close it
(`OnlinePause_Frame`, called by `MainFrame_GameLogic` before retail's pause logic, owns Start
while the menu is open or the room is frozen ; retail's pause cooldown only counts down under
`PAUSE_1`, so it is reset there). PAUSE FOR EVERYONE sets `octrRoomInfo[ONLINE_ROOM_PAUSED]` on
the host : the page relays the room info in our LOBBY message as D12.3, nothing on the wire, and
each game freezes the retail way (`PAUSE_1`, the audio paused, « PAUSED BY THE HOST ») until the
host's RESUME FOR EVERYONE (or its Start). `sv_core` keeps ticking in the host's page
(`WebOnline_FrameEnd`), and the page's end-of-race timeout does not count the time paused. A
frozen guest's Start opens its menu with RESUME (the menu closes, the game stays frozen) and QUIT ;
only the host unfreezes. A guest whose host leaves while paused runs again with the takeover
(D11.6).

**D12.10 — The host skips the rankings (session 32d).** The results after a race, the Cup
standings between two races and the final standings wait for the server's reset (`ROOM_RESET_MS`,
6 s after the last finisher), then a Cup's next lock 3 s more (D12.1). On the host, once the
table is complete, « CROSS : CONTINUE » shows under it and its Cross ends that wait for everyone :
`SvCore_SkipReset` (the server runs in the host's page, `WebHost_Service`) resets the room at the
next tick, a local call with nothing new on the wire, and a Cup's next track locks at once. The
guests follow the server's `SG_NEWCLIENT` / `SG_TRACK` as they would 6 s later ; their Cross does
nothing there. The native build's server runs in its own process : no skip there.

**D12.11 — A room link skips everything (session 32e, the user's design).** A room link opened
with the disc stored boots the game at once, no press : the page's boot screen stays, saying
« Joining the room… » with a Back button (Escape too), while the game runs behind it with every
intro wait cut (`introSkip()` true while joining, `web/ui/src/lib/input-hook.js`) and enters the
room on its title (`pendingEnter`). The boot screen goes once the game is in the host's menus with
its picture over the canvas (`page.js` `ctrUI.joining(null)`). The room racing : « The room is
racing — you join at the next character select ». A failure (the relay silent, no host in the room)
shows its reason ; Back clears the link, leaves the room and shows the player's own title. With no
stored disc the drop comes first, then the same screen. A pad press is no gesture for the
browser's sound : a player on a pad alone gets a « Click for sound » toast that stays until the
first click or key.

**D12.12 — A guest's QUIT, a lost guest : back at the next lobby (session 32f, the user,
2026-11-06).** A guest's pause menu QUIT › YES leaves the race, not the room :
`OnlineRoom_GuestQuit` (`native_bridge.c`, from `MainFreeze_MenuPtrQuit`) tells the page
(`NativeWeb_RoomQuit` → `Module.ctrInput.roomQuit`) and retail's quit runs on — this game back to its
title, its link closed, the host's AI on its kart in Arcade (D11.6), VS's retail leave. The page keeps
the room (`away`, `web/online/page.js`) : its link to the host comes back (`rejoin`, quiet), the host's
picture shows over the game with a band — « The room is racing — you join at the next lobby » or, in a
Cup, « Watching the Cup — you join after the final standings » — and Back (Escape, the Triangle key or
pad button, a click) leaves the room for good, the player's own main menu as after 32e. The game is let
in (`CTL.enter`) once the host's room info, sent to a guest page as soon as it listens, says no Cup
(`letIn`, `web/online/rules.js`) : it retries the join every 2 s, the locked room refuses it, and the
reset takes it — a race's end, the Cup's final standings, the host's QUIT. A guest that lost its link
takes the same path : the host still on the meeting point, at once (its game leaves the race) ; the host
not seen, after the race it finished alone (session 32) — the host there again, back in the room ; gone,
« The room is closed » as before. (The host not seen while it is still there takes the relay's list
missing it : a host that drops off the relay does not join it again today, so its room is closed to
every new link.)

While a guest watches, the host's capture keeps presenting frames during its race (`web/share/panel.js` ;
the guest's page says so with a LOBBY `{watching}` on the Share link, our framing) ; its sound stays off
as in any race. Nothing else moves : in a race a leaver's Share slot stays a hole (`compactNow`,
`web/share/host.js`) — the guests above keep their slot and their pad's P-number, and the leaver coming
back takes its own slot again ; a hole still free when the host's menus come back is filled then
(`compactHoles`), the game told each slot (`CTL.slotGone`), and the character select moves the
characters above it down even before it takes input (`OnlineCharacters_Follow`). The menus show the
room's tag top right (`OnlineRoom_DrawTag`, the version's font and grey) : 4 characters of
`23456789ABCDEFGHJKLMNPQRSTUVWXYZ` from the room id's FNV-1a hash (`roomTag`), the same on every page of
the room — the id's own base64url would lose its case in the game's capitals.


## D13 — Netplay rooms from the game (session 28)

Settled with the user on drawings first (2026-11-11). The room link of D10's time stays ; the game
gains everything a pad needs to host, invite and join.

**D13.1 — A mode hosts the room.** NETPLAY opens its menu with no room : VS, BATTLE, ARCADE, JOIN.
A mode picked with no room asks the page for one (`NativeWeb_NetplayHost`) and waits under
« OPENING ROOM... » (`NetplayOpening_Frame`, `game/230/MM_MenuFlow.c`) until this game is its
room's host in its lobby (`LOBBY_HOST_TRACK_PICK` : the states before it reset the menu path) ; the
mode's own screens follow. Triangle back to the NETPLAY menu keeps the room, so another mode is
the same room ; the main menu's top level closes it (32e). What the page says of the room is one
number (`NativeWeb_NetplayStatus`, `NP` in `web/online/page.js`) : on its way, waiting for the
host's yes, there, or why not — no key, key refused, relay silent, no such room, full, refused. A
room that cannot open is said in a box under the NETPLAY menu : NO RELAY KEY and KEY REFUSED offer
OPEN SETTINGS, RELAY OFFLINE offers TRY AGAIN.

**D13.2 — VS and BATTLE open alone, and wait at the lock.** No row is grey any more. Alone, the
character select takes the player's lock and stays (`OnlineRoom_NeedsPlayer`) : a banner says
WAITING FOR PLAYER 2 ; a guest arriving grows the select (D12.7), and everyone locked goes on. A
guest leaving a VS or BATTLE select no longer sends the host back a menu : it waits there again.
ARCADE starts alone, with its bots.

**D13.3 — The code is characters.** A room's code is 3 of the game's 15 characters — 3 375 codes —,
4 or 5 when the relay is crowded (`web/net/code.js`). The host draws it : the room id and the room
secret are both derived from it in the browser (PBKDF2-SHA-256), so the relay keeps no table, sees
no code and is not changed. The relay's answer to a hello already lists who is in a room : a host
that finds another host under its code leaves and draws again, and three of those in a row add a
character (`openFreeRoom`, `web/online/rules.js`). The first length is the site's setting,
`web/online/config.json` (`codeLength`), read by the page at boot — edited without building the
game. The link carries the code (`c=`) beside the room and the secret it gives, the relay and its
key : a click is still enough.

**D13.4 — The host's door.** So few codes can be tried one by one by whoever may use the relay.
Knowing the code therefore only lets a guest knock (`web/net/admit.js`) : the host's game shows
« BEE WANTS IN », ACCEPT / REFUSE, on its menus (in a race the game draws one line, the box comes
with the menus : D14.5). The link carries a random pass (`t=`), not derivable from the code : its guest comes
straight in. A guest let in once comes back without being asked (its QUIT, a lost link : D12.12).
Until it is let in a guest gets nothing of the room — the host's server and lobby share only ever
see its link then. Not covered : someone holding the relay key who guesses the code can still read
what the relay carries for that room (names, kart states) ; to settle before a public relay.

**D13.5 — INVITE.** On a room's menus the pad's Select (the Space key) shows the code large : the
characters' pictures and names, « NETPLAY - JOIN », and the page copies the link. Select no longer
leaves the room there (upstream's `DisconSELECT` still does in a race). The tag of the menus
(D12.12) is the code's pictures in a box whose top border carries ROOM — top right, bottom right
on the track and cup selects, whose title is top right.

**D13.6 — JOIN.** One dial per character : Up / Down turn it (the picture slides ; the dial in
hand sits in a square, an arrow above and below it), Left / Right change dial, Right past the last one adds a dial up to
five and Square takes it away, Start or Cross on the last dial joins, Triangle goes back. The
keyboard drives it with the same keys as every menu. The page looks for the room on the relay and
key of Settings (`joinByCode`) : a code no host holds is said at once (the relay's answer lists
nobody hosting), then « WAITING FOR THE HOST » until its yes. What fails is a red line on the
dials, which stay as they are : NO SUCH ROOM, ROOM FULL, RELAY OFFLINE, THE HOST SAID NO. In, the
game enters the room under the host's picture, in the host's mode, as a link's guest does.

**D13.7 — The relay and its key.** Settings › Netplay holds both ; they are saved as typed. A room
link's relay and key are kept when Settings has no key yet (never over one already there).

These screens are drawn by `OnlineNetplay_Frame`, called once a frame from `MainFrame_RenderFrame`
after the pad was read : a screen that is up takes P1's presses, and the menu under it is neither
run nor drawn that frame. Each has its way back.

## D14 — A room's code on the home page, Netplay and Share (session 28b)

Settled with the user on drawings first (2026-11-11). The page offers one thing before the game
starts — joining a room by its code ; everything else of a room is in the game.

**D14.1 — « or join a room ».** The index page is the disc's : « Drop your disc image », or « Game
ready » with a stored disc. Under either card a small link turns the page into the room code's
dials (`web/ui/src/Join.svelte`), with a Back. They are the game's JOIN (D13.6), rule for rule
(`web/ui/src/lib/join.js` `press`) : Up / Down turn a dial, Left / Right change dial, Right past
the last adds one up to five, Square takes it away, Start — or Cross on the last dial — joins,
Triangle or Escape goes back. The keyboard's arrows, Enter and the player's own menu keys, a
pad (Square opens the dials from the home page, Cross still plays), and the mouse (each dial's
arrows, « + », the buttons) all drive them. The code is kept from one visit to the next.

**D14.2 — Pictures with no disc.** The page has no game data when it shows the dials, and none is
ever hosted : each of the 15 characters is an original pictogram (`web/ui/src/lib/pictos.js`), a
flat generic animal per name — nothing of a character's design is taken. The names under them are
the game's, as plain text : they are what is said aloud, and what the game's own dials show. In the
game the dials keep the game's icons.

**D14.3 — The room's kind, before any disc.** A Netplay room needs the player's own game, a Share
room does not : the page must know which before it asks for a disc, and before it knocks. A host's
hello to the relay carries its room's kind as its signaling `name` (`ROOM_KIND`, `web/net/code.js` :
`ctr-room:netplay`, `ctr-room:share` — longer than a player's name can be) ; the relay hands names
back in its peer list, as it always did, and is not changed. The page derives the room from the
code, says hello without staying (`lookRoom`, `web/net/signaling.js`) and reads the host's name
(`roomKind`). A host from before the kinds sent its player's name there : it reads as Netplay,
which is what its room is. No page sends a player's name to the relay any more.

**D14.4 — By its kind.** A Share room : the page goes to the guest page with the room's link, the
code in it and no pass — the guest knocks (D14.5), then sees the host's screen ; refused, or the
host gone, it comes back to the dials with the reason. A Netplay room, the disc stored : the game
boots behind the joining card and the Netplay page joins the code as the game's JOIN does (`#c=`,
read once by `web/online/page.js`) ; the card says « Waiting for the host » until its yes. A
Netplay room and no disc : the drop zone comes back saying why — « This room plays Netplay : each
player runs their own game » — and the dropped disc boots into the room ; the host is only asked
once the game is there. What fails is a red line on the dials, kept, in the game's words : NO SUCH
ROOM, ROOM FULL, RELAY OFFLINE, THE HOST SAID NO (and THE HOST LEFT, NO DIRECT CONNECTION for
Share). With no relay key in the browser, or a refused one, the page says so and takes the relay
and its key there (the Netplay settings only exist once the game runs) ; they are kept where
Settings › Netplay reads them. A room link still joins as before : no dials, no host's yes.

**D14.5 — A Share room has a code and a door.** Hosting Share opens the room under a code as a
Netplay mode does (`codeRoom`, `openFreeRoom` — now in `web/net/code.js`, with the door in
`web/net/admit.js` : Share has them in a build without Netplay too) ; its link carries the code
and a pass. The page says the code once, in the toast of Share starting. From there it is the
game's : while this page hosts a Share room (`NativeWeb_ShareHost`) the menus show the room's tag,
Select opens INVITE (« HOME PAGE - JOIN A ROOM ») and a guest who typed the code is asked for with
the same box as a Netplay room's. Off the menus — a race, its results — the box does not come :
one line in the game's font says « BEE WANTS IN » (`OnlineDoor_DrawLine`), and the box is there
with the next menu. A Netplay host's mid-race page toast became the same line. A build without
Netplay has none of these screens in its game : its Share room has no code, the link alone joins.

## D15 — Couch from the game, and the players who are in (session 29)

Settled with the user on drawings first, over four rounds (2026-11-12). Share is named **Couch** ;
it is switched on and off in the game, and a local mode's players are no longer « the pads plugged
in » but the players who are in.

**D15.1 — Who is in.** On the web (the Netplay build, outside a Netplay room) whatever navigates is
P1 : every keyboard and pad that holds no seat drives it. A second device takes a seat — P2, then
P3, P4 — by pressing Start on the character select of ARCADE, VS or BATTLE, unless it is the device
that navigated last (that one is P1's) ; it gives the seat back by holding Select alone for a
second, anywhere on the menus. The press that took or gave back a seat is nobody's. The seats are
the page's (`web/share/slots.js`) : a local device holds one as `local:<id>`, a Couch guest as its
peer, so the players are one run in the order they came, and a gap closes on the menus (the ones
above move down ; the select moves their character and lock with them, as a Netplay room's does —
`NativeWeb_SeatGone`). `platform/native_input.c` (`NativeInput_WebSeatPlayers`) composes the four
pads the game reads from the devices and the seats, once per input update. Settings › Players
still lists the devices in the order they were plugged : it says who may play on this page, the
game says who does.

**D15.2 — No players menu.** VS and BATTLE go straight to the character select, ARCADE through its
difficulty, with whoever is in : the 2P / 3P / 4P and 1P / 2P boxes are not shown on the web
(`LocalSeats_On`, `game/230/MM_MenuFlow.c`). The select follows who comes and goes
(`OnlineCharacters_Follow`, now local play's too) — ARCADE up to 2 players, VS and BATTLE up to 4.
A VS or BATTLE alone locks and waits : WAITING FOR PLAYER 2. TIME TRIAL and ADVENTURE are P1's.
The native build keeps the retail boxes.

**D15.3 — Couch on.** On that select the pad's Select (the Space key) opens a Couch room, on the
relay and key of Settings › Netplay — one relay, one key for Netplay and Couch
(`NativeWeb_CouchStart`, the page's `couchStart`). OPENING ROOM... until it is on (Triangle
cancels), then INVITE by itself : the code, HOME PAGE - JOIN A ROOM, and its rows (D15.4, D15.8).
With no key : NO RELAY KEY (OPEN SETTINGS /
BACK) ; a refused key : KEY REFUSED ; a relay that does not answer : RELAY OFFLINE (TRY AGAIN /
BACK) — a box over the select, Triangle is BACK. Once on, the menus show the room's tag and Select
is INVITE (D14.5) ; a guest let in is a player more, with a cursor on the select at once.

**D15.4 — Couch off.** A Couch room's INVITE has three rows : BACK (Cross, Triangle or Select
again), MORE INFO (D15.8) and STOP COUCH, which closes the room where the host stands. Going back to the main
menu closes it too, as it closes a Netplay room — a race's QUIT included. The guests are told : one
who came by code is back on its dials under THE HOST LEFT, a link's guest reads its page's own
line.

**D15.5 — Who is connected by what.** While P1 holds L1 and R1 on the menus, a panel on the right
lists the players : the number, a house (this machine) or a globe (a Couch guest), a pad or a
keyboard, the character's icon and name. The four small pictures are drawn for it, as runs of
squares (`Couch_DrawIcon`) : the game has none. The select's bottom line says the rest : SELECT -
COUCH (or INVITE), L1 R1 - PLAYERS, and START - JOIN (with the keyboard's Start key when the
keyboard may join) or HOLD SELECT - LEAVE.

**D15.6 — No direct connection.** Couch streams peer to peer : a guest whose link is the relay's
is refused, and reads NO DIRECT CONNECTION on its dials. The host's game says it too, one line for
a few seconds (`NativeWeb_CouchSaid`), on the menus or in a race.

**D15.7 — The page.** Settings › Multiplayer › Couch : the room's code (read only), Stop, the relay
and its key — the Netplay tab's own, typed in either —, the video bitrate, who is in. No start
button : Couch starts in the game. A build without Netplay has none of these screens in its game :
its panel keeps its own relay, key and buttons, and the link alone joins. The relay is not changed.

**D15.8 — The limits, under MORE INFO.** First shown before each launch (b.8), then moved where
it is asked for (the user, b.10) : nothing stands between the player and the room. A room's INVITE
— Couch's or Netplay's — has a row MORE INFO, and the NETPLAY menu a fifth row of that name ; it
opens a page (`NetplayHelp_Frame`) saying what the mode is and what it cannot do, and any button
goes back to the code, or to the menu. NETPLAY : everyone on their own screen, each with their own
disc, one player per browser, up to four in a room. Couch : the host's screen is streamed — no disc
needed, some delay for the guests —, several players on the host's machine and one per guest, four
in all. The page's Settings › Help says the same, with how a player joins and leaves, while the
game runs. What comes next (several players per guest, per Netplay browser) is the README's to
say, not the game's.
