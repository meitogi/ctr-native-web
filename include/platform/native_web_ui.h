#ifndef NATIVE_WEB_UI_H
#define NATIVE_WEB_UI_H

// The browser page's « Skip intro » setting (web/ui/, Settings › Player ; on by default).
// NativeWeb_IntroSkip() returns 1 once per recent press — any key but the debug F-keys, any pad
// button — while the setting is on, and the intro screens that test it end at once : SCEA
// (game/MAIN/MainMain.c), the copyright wait (game/LOAD/LOAD_TenStages.c), the Naughty Dog crate
// (game/233/CS_Thread.c), the title / trophy animation (game/230/MM_Title.c). The disc loads
// between them are not shortened. Defined in platform/native_input.c ; the page is pulled, it
// never calls in (ASYNCIFY). Native builds : always 0, the original intro.
// NativeWeb_OpenMultiplayer() opens the page's multiplayer panel (Settings › Netplay).
// NativeWeb_NetplayHost() : NETPLAY's VS, BATTLE or ARCADE, picked with no room joined
// (game/230/MM_MenuFlow.c, CTR_ONLINE builds) — 1 when the page hosts a room at once with its
// saved relay and key, 0 when it has none (the game then says why, and offers the panel).
// NativeWeb_NetplayStatus() : the room a mode or JOIN asked the page for, as enum NetplayStatus
// (game/230/MM_MenuFlow.c ; web/online/page.js NP) — on its way, waiting for the host's yes,
// there, or why not.
// NativeWeb_NetplayJoin(code) : NETPLAY > JOIN, its dials set — one hex digit per character id ;
// 0 with no relay key. NativeWeb_NetplayCancel() : its Triangle while the room is on its way.
// NativeWeb_RoomCode(buf, size) : the page's room as its code (the same digits), 0 with none.
// NativeWeb_Invite() : INVITE on a room's menus — the page copies the room link.
// NativeWeb_AskName(buf, size) : the name of a guest who typed the code and waits for the host's
// yes, 0 with nobody waiting ; NativeWeb_AskAnswer(yes) lets it in or sends it away.
// NativeWeb_LeaveRoom() : back on the main menu after a Netplay room (game/230/MM_MenuFlow.c) — the
// page leaves its room, if it still has one, as its Leave button does.
// NativeWeb_RoomQuit() : a guest's QUIT in a Netplay race (game/MAIN/MainFreeze.c, session 32f) —
// the page keeps the room : the player watches the host's race and comes back at the next lobby.
// NativeWeb_RoomTag(buf, size) : the page's room, as the 4 characters drawn top right in the menus
// (game/OnlineCTR/thread.c, session 32f) ; 0 with no room.
// NativeWeb_RoomGuestMask() : the slots a room's guests hold (bit n = slot n, the share pads of
// platform/native_input.c) — a room's humans are the host and these, never a pad of the host's.
#if defined(__EMSCRIPTEN__)
#include <emscripten/em_macros.h>
// declared as the EM_JS import it is : the game's files see this before the EM_JS (unity build)
int NativeWeb_IntroSkip(void) EM_IMPORT(NativeWeb_IntroSkip);
#ifdef USE_ONLINE
void NativeWeb_OpenMultiplayer(void) EM_IMPORT(NativeWeb_OpenMultiplayer);
int NativeWeb_NetplayHost(void) EM_IMPORT(NativeWeb_NetplayHost);
int NativeWeb_NetplayStatus(void) EM_IMPORT(NativeWeb_NetplayStatus);
int NativeWeb_NetplayJoin(const char *code) EM_IMPORT(NativeWeb_NetplayJoin);
void NativeWeb_NetplayCancel(void) EM_IMPORT(NativeWeb_NetplayCancel);
void NativeWeb_Invite(void) EM_IMPORT(NativeWeb_Invite);
void NativeWeb_AskAnswer(int yes) EM_IMPORT(NativeWeb_AskAnswer);
int NativeWeb_RoomCode(char *buf, int size);
int NativeWeb_AskName(char *buf, int size);
void NativeWeb_LeaveRoom(void) EM_IMPORT(NativeWeb_LeaveRoom);
void NativeWeb_RoomQuit(void) EM_IMPORT(NativeWeb_RoomQuit);
int NativeWeb_RoomTag(char *buf, int size) EM_IMPORT(NativeWeb_RoomTag);
int NativeWeb_RoomGuestMask(void);
#endif
#else
#define NativeWeb_IntroSkip() 0
#define NativeWeb_OpenMultiplayer() ((void)0)
#define NativeWeb_NetplayHost() 0
#define NativeWeb_NetplayStatus() 0
#define NativeWeb_NetplayJoin(code) 0
#define NativeWeb_NetplayCancel() ((void)0)
#define NativeWeb_Invite() ((void)0)
#define NativeWeb_AskAnswer(yes) ((void)0)
#define NativeWeb_RoomCode(buf, size) 0
#define NativeWeb_AskName(buf, size) 0
#define NativeWeb_LeaveRoom() ((void)0)
#define NativeWeb_RoomQuit() ((void)0)
#define NativeWeb_RoomTag(buf, size) 0
#endif

#endif
