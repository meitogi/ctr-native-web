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
// NativeWeb_NetplayHost() : the main menu's NETPLAY row, picked with no room joined
// (game/230/MM_MenuFlow.c, CTR_ONLINE builds) — 1 when the page hosts a room at once with its
// saved relay and key, 0 when it has none (the game then says why, and offers the panel).
// NativeWeb_RoomAlone() : a Netplay VS / BATTLE character select left with one human goes back a
// menu (game/230/MM_Characters.c) ; the page says why in a toast.
#if defined(__EMSCRIPTEN__)
#include <emscripten/em_macros.h>
// declared as the EM_JS import it is : the game's files see this before the EM_JS (unity build)
int NativeWeb_IntroSkip(void) EM_IMPORT(NativeWeb_IntroSkip);
#ifdef USE_ONLINE
void NativeWeb_OpenMultiplayer(void) EM_IMPORT(NativeWeb_OpenMultiplayer);
int NativeWeb_NetplayHost(void) EM_IMPORT(NativeWeb_NetplayHost);
void NativeWeb_RoomAlone(void) EM_IMPORT(NativeWeb_RoomAlone);
#endif
#else
#define NativeWeb_IntroSkip() 0
#define NativeWeb_OpenMultiplayer() ((void)0)
#define NativeWeb_NetplayHost() 0
#define NativeWeb_RoomAlone() ((void)0)
#endif

#endif
