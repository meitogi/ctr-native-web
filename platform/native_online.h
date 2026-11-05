#ifndef NATIVE_ONLINE_H
#define NATIVE_ONLINE_H

#include "native_online_transport.h"

// OnlineCTR client bridge, in-process (was CL_main.cpp).
// docs/ONLINECTR_PORT.md, D3.

// Player name (NAME_LEN chars max) and the address used for the
// "private server" entry of the server menu ("host:port").
// Defaults: env CTR_ONLINE_NAME / CTR_ONLINE_SERVER, else "Player" / 127.0.0.1:64001.
void NativeOnline_Configure(const OnlineTransport *transport, const char *name, const char *privateServer);

// Once per game frame, where the PS1 build set octr->readyToSend.
void NativeOnline_Frame(void);

unsigned int NativeOnline_FrameCount(void);

// One build (docs/ONLINECTR_PORT.md, D8) : the host layer's commands, polled
// once per frame. poll() returns the next command (0 = none) and its argument.
enum NativeOnlineControl
{
	NATIVE_ONLINE_CTL_NONE,
	NATIVE_ONLINE_CTL_ENTER,     // join the page's room (waits for the title)
	NATIVE_ONLINE_CTL_LEAVE,     // leave the room
	NATIVE_ONLINE_CTL_CHARACTER, // arg = this guest's character, picked on the host
	NATIVE_ONLINE_CTL_END_RACE,  // end this player's race now (the host's end-of-race timeout)
	NATIVE_ONLINE_CTL_END_BOTS,  // the host : end its bots' races too (docs/ONLINECTR_PORT.md, D11.7)
	NATIVE_ONLINE_CTL_SLOT_GONE, // the host : arg = the lobby slot a guest left, the ones above moved down (session 32e)
};
void NativeOnline_SetControl(int (*poll)(int *arg));

// The host's bots (docs/ONLINECTR_PORT.md, D11), registered by
// platform/native_online_bots.c on the host's in-process server ; none elsewhere.
typedef struct NativeOnlineBotHooks
{
	void (*join)(void);  // before CG_TRACK : the bots enter the room
	void (*lock)(void);  // after CG_TRACK : their characters, locked
	void (*frame)(void); // once per bridge frame : their race messages
	void (*leave)(void); // the host's client leaves the room : so do they
} NativeOnlineBotHooks;
void NativeOnline_SetBotHooks(const NativeOnlineBotHooks *hooks);

#if defined(__EMSCRIPTEN__) && !defined(NDEBUG)
// Debug web builds (window.__ctr.net, platform/web_debug_bridge.c) : called for
// each SG_RACEDATA applied to a remote kart, before its pose is written.
extern void (*NativeOnline_DebugRaceData)(int slot, int posX, int posY, int posZ);
#endif

#endif
