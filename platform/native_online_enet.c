// OnlineTransport over ENet (externals/enet), the protocol public
// OnlineCTR servers speak. One host, one peer, channel 0, as CL_main.cpp.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <enet/enet.h>

#include "native_online_transport.h"

static ENetHost *clientHost;
static ENetPeer *serverPeer;
static int boolEnetInit;
static int lastReceivedReliable;

// flags of the last DATA event, for the message traces of tests/online
int NativeOnlineEnet_LastReceivedReliable(void)
{
	return lastReceivedReliable;
}

static void NativeOnlineEnet_Disconnect(void)
{
	if (serverPeer)
		enet_peer_disconnect_now(serverPeer, 0);
	serverPeer = NULL;

	if (clientHost)
	{
		enet_host_flush(clientHost);
		enet_host_destroy(clientHost);
	}
	clientHost = NULL;
}

static int NativeOnlineEnet_Connect(const char *address)
{
	ENetAddress addr;
	char host[64];
	const char *colon;
	size_t hostLen;

	if (!boolEnetInit)
	{
		if (enet_initialize() != 0)
			return -1;
		atexit(enet_deinitialize);
		boolEnetInit = 1;
	}

	NativeOnlineEnet_Disconnect();

	colon = strrchr(address, ':');
	hostLen = colon ? (size_t)(colon - address) : strlen(address);
	if (hostLen >= sizeof(host))
		return -1;
	memcpy(host, address, hostLen);
	host[hostLen] = '\0';

	if (enet_address_set_host(&addr, host) != 0)
		return -1;
	addr.port = colon ? (enet_uint16)atoi(colon + 1) : 64001;

	clientHost = enet_host_create(NULL /* create a client host */,
		1 /* only allow 1 outgoing connection */,
		2 /* allow up 2 channels to be used, 0 and 1 */,
		0 /* assume any amount of incoming bandwidth */,
		0 /* assume any amount of outgoing bandwidth */);
	if (!clientHost)
		return -1;

	serverPeer = enet_host_connect(clientHost, &addr, 2, 0);
	if (!serverPeer)
	{
		NativeOnlineEnet_Disconnect();
		return -1;
	}

	return 0;
}

static void NativeOnlineEnet_Send(const void *buf, int len, int reliable)
{
	ENetPacket *packet;

	if (!serverPeer)
		return;

	packet = enet_packet_create(buf, len, reliable ? ENET_PACKET_FLAG_RELIABLE : ENET_PACKET_FLAG_UNSEQUENCED);
	if (enet_peer_send(serverPeer, 0, packet) < 0)
		enet_packet_destroy(packet);
}

static int NativeOnlineEnet_Poll(void *buf, int cap, int *event)
{
	ENetEvent ev;
	int len;

	*event = ONLINE_EVENT_NONE;

	while (clientHost && enet_host_service(clientHost, &ev, 0) > 0)
	{
		switch (ev.type)
		{
			case ENET_EVENT_TYPE_CONNECT:
				// 5 seconds
				enet_peer_timeout(ev.peer, 1000000, 1000000, 5000);
				*event = ONLINE_EVENT_CONNECTED;
				return 0;

			case ENET_EVENT_TYPE_DISCONNECT:
				serverPeer = NULL;
				*event = ONLINE_EVENT_DISCONNECTED;
				return 0;

			case ENET_EVENT_TYPE_RECEIVE:
				len = (int)ev.packet->dataLength;
				if (len > cap)
					len = cap;
				memcpy(buf, ev.packet->data, len);
				lastReceivedReliable = (ev.packet->flags & ENET_PACKET_FLAG_RELIABLE) != 0;
				enet_packet_destroy(ev.packet);
				*event = ONLINE_EVENT_DATA;
				return len;

			default:
				break;
		}
	}

	return -1;
}

const OnlineTransport NativeOnline_EnetTransport = {
	NativeOnlineEnet_Connect,
	NativeOnlineEnet_Send,
	NativeOnlineEnet_Poll,
	NativeOnlineEnet_Disconnect,
};
