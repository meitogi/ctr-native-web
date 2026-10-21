// OnlineTransport to the in-process server core (host only).
// Messages are queued both ways, so the bridge drains them in
// NativeOnline_Frame() like any network backend.

#include <string.h>

#include "native_online_transport.h"
#include "native_online_loopback.h"

#define LOOPBACK_QUEUE 256
#define LOOPBACK_MAX_PACKET 64

static struct
{
	int event;
	int len;
	int reliable;
	unsigned char data[LOOPBACK_MAX_PACKET];
} queue[LOOPBACK_QUEUE];
static int queueHead, queueCount;

static SvCoreHost inner;
static SvCoreHost wrapped;
static int boolConnected;
static int lastReceivedReliable;

// flags of the last DATA event, for the message traces of tests/online
int NativeOnlineLoopback_LastReceivedReliable(void)
{
	return lastReceivedReliable;
}

static void Push(int event, const void *buf, int len, int reliable)
{
	int i;

	if (queueCount == LOOPBACK_QUEUE)
		return;

	if (len > LOOPBACK_MAX_PACKET)
		len = LOOPBACK_MAX_PACKET;

	i = (queueHead + queueCount) % LOOPBACK_QUEUE;
	queue[i].event = event;
	queue[i].len = len;
	queue[i].reliable = reliable;
	if (len > 0)
		memcpy(queue[i].data, buf, len);
	queueCount++;
}

// === server core side ===

static void Loopback_CoreSend(int peerId, const void *buf, int len, int reliable)
{
	if (peerId != NATIVE_ONLINE_LOOPBACK_PEER)
	{
		inner.send(peerId, buf, len, reliable);
		return;
	}

	if (boolConnected)
		Push(ONLINE_EVENT_DATA, buf, len, reliable);
}

static void Loopback_CoreKick(int peerId)
{
	if (peerId != NATIVE_ONLINE_LOOPBACK_PEER)
	{
		inner.kick(peerId);
		return;
	}

	if (boolConnected)
	{
		boolConnected = 0;
		Push(ONLINE_EVENT_DISCONNECTED, NULL, 0, 1);
	}
}

static void Loopback_CoreSetTimeout(int peerId, int ms)
{
	if (peerId != NATIVE_ONLINE_LOOPBACK_PEER && inner.setTimeout)
		inner.setTimeout(peerId, ms);
}

const SvCoreHost *NativeOnlineLoopback_Wrap(const SvCoreHost *innerHost)
{
	inner = *innerHost;
	wrapped = inner;
	wrapped.send = Loopback_CoreSend;
	wrapped.kick = Loopback_CoreKick;
	wrapped.setTimeout = Loopback_CoreSetTimeout;
	return &wrapped;
}

// === client side ===

static void Loopback_Disconnect(void)
{
	queueHead = queueCount = 0;

	if (boolConnected)
	{
		boolConnected = 0;
		SvCore_Disconnect(NATIVE_ONLINE_LOOPBACK_PEER);
	}
}

static int Loopback_Connect(const char *address)
{
	(void)address;

	Loopback_Disconnect();

	boolConnected = 1;
	Push(ONLINE_EVENT_CONNECTED, NULL, 0, 1);
	SvCore_Connect(NATIVE_ONLINE_LOOPBACK_PEER, ~0ull);
	return 0;
}

static void Loopback_Send(const void *buf, int len, int reliable)
{
	(void)reliable;

	if (boolConnected)
		SvCore_Receive(NATIVE_ONLINE_LOOPBACK_PEER, buf, len);
}

static int Loopback_Poll(void *buf, int cap, int *event)
{
	int len;

	*event = ONLINE_EVENT_NONE;
	if (queueCount == 0)
		return -1;

	*event = queue[queueHead].event;
	len = queue[queueHead].len;
	if (len > cap)
		len = cap;
	memcpy(buf, queue[queueHead].data, len);
	lastReceivedReliable = queue[queueHead].reliable;

	queueHead = (queueHead + 1) % LOOPBACK_QUEUE;
	queueCount--;
	return len;
}

const OnlineTransport NativeOnline_LoopbackTransport = {
	Loopback_Connect,
	Loopback_Send,
	Loopback_Poll,
	Loopback_Disconnect,
};
