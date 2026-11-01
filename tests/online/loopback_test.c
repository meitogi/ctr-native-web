// The loopback queue to the host's own client when that client stops draining
// it (the web host on its pause menu while its server keeps serving the
// guests) : once full, the oldest kart states make room, a reliable message
// is never dropped.

#include <stdio.h>
#include <string.h>

#include "../../platform/native_online_loopback.h"
#include "../../platform/native_online_transport.h"

extern const OnlineTransport NativeOnline_LoopbackTransport;

static void NoSend(int peerId, const void *buf, int len, int reliable) { (void)peerId; (void)buf; (void)len; (void)reliable; }
static void NoKick(int peerId) { (void)peerId; }
static void NoLog(const char *fmt, ...) { (void)fmt; }

int main(void)
{
	static const SvCoreHost inner = {NoSend, NoKick, NULL, NoLog};
	const SvCoreHost *core = NativeOnlineLoopback_Wrap(&inner);
	unsigned char buf[64];
	int event, len, unreliable = 0, reliable = 0, lastUnreliable = -1, failures = 0;

	SvCore_Init(core);
	NativeOnline_LoopbackTransport.connect("loopback");
	while (NativeOnline_LoopbackTransport.poll(buf, sizeof(buf), &event) >= 0)
		; // CONNECTED, the room list

	// 300 kart states (more than the queue holds), a weapon, 10 more states
	for (int i = 0; i < 300; i++)
	{
		unsigned char kart[2] = {7, (unsigned char)i};
		core->send(NATIVE_ONLINE_LOOPBACK_PEER, kart, 2, 0);
	}
	{
		unsigned char weapon[2] = {8, 0xaa};
		core->send(NATIVE_ONLINE_LOOPBACK_PEER, weapon, 2, 1);
	}
	for (int i = 0; i < 10; i++)
	{
		unsigned char kart[2] = {7, (unsigned char)(300 + i)};
		core->send(NATIVE_ONLINE_LOOPBACK_PEER, kart, 2, 0);
	}

	while ((len = NativeOnline_LoopbackTransport.poll(buf, sizeof(buf), &event)) >= 0)
	{
		if (event != ONLINE_EVENT_DATA || len != 2)
			continue;
		if (buf[0] == 8)
			reliable++;
		else
		{
			unreliable++;
			lastUnreliable = buf[1];
		}
	}

	if (reliable != 1) { printf("FAILED: the reliable message was dropped (%d)\n", reliable); failures++; }
	if (unreliable != 255) { printf("FAILED: %d kart states kept, wanted the queue's 255 others\n", unreliable); failures++; }
	if (lastUnreliable != (unsigned char)309) { printf("FAILED: the newest kart state is %d, wanted 309 (& 0xff)\n", lastUnreliable); failures++; }
	if (!failures)
		printf("PASSED: full queue keeps the reliable message and the newest %d kart states\n", unreliable);
	return failures ? 1 : 0;
}
