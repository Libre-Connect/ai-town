# -*- coding: utf-8 -*-
import asyncio
import contextlib
import http.cookies
import os
import random
import sys
import time
from typing import *

import aiohttp

import blivedm
import blivedm.models.web as web_models
from blivedm import handlers

# 直播间ID的取值看直播间URL
TEST_ROOM_IDS = [1730460074]

# 这里填一个已登录账号的cookie的SESSDATA字段的值。不填也可以连接，但是收到弹幕的用户名会打码，UID会变成0
SESSDATA = 'eae48c56%2C1779403256%2C61924%2Ab2CjAWieSfrT96Kb4KcyvSwX7wbf2-j-cM9eBZZQ0AL1sHQDWy9QtA-XoQljk2v2lDCwsSVlppenlZUjFYWnJ4MDFYNDVmMkYyM21lSkF1ZFljejNERkJkVklzZFUzSHlyanhhY25IaG83amtwR3NmSmJlalZoaUJWclc3cGltY1YtRnBKQ0ExYlZ3IIEC'

session: Optional[aiohttp.ClientSession] = None


async def main():
    init_session()
    try:
        await run_single_client()
        await run_multi_clients()
    finally:
        await session.close()


def init_session():
    cookies = http.cookies.SimpleCookie()
    cookies['SESSDATA'] = SESSDATA
    cookies['SESSDATA']['domain'] = 'bilibili.com'

    global session
    session = aiohttp.ClientSession()
    session.cookie_jar.update_cookies(cookies)


async def run_single_client():
    """
    演示监听一个直播间
    """
    room_id = random.choice(TEST_ROOM_IDS)
    client = blivedm.BLiveClient(room_id, session=session)
    handler = MyHandler()
    client.set_handler(handler)

    client.start()
    try:
        # 演示5秒后停止
        await asyncio.sleep(5)
        client.stop()

        await client.join()
    finally:
        await client.stop_and_close()


async def run_multi_clients():
    """
    演示同时监听多个直播间
    """
    clients = [blivedm.BLiveClient(room_id, session=session) for room_id in TEST_ROOM_IDS]
    handler = MyHandler()
    for client in clients:
        client.set_handler(handler)
        client.start()

    try:
        await asyncio.gather(*(
            client.join() for client in clients
        ))
    finally:
        await asyncio.gather(*(
            client.stop_and_close() for client in clients
        ))


class MyHandler(blivedm.BaseHandler):
    # # 演示如何添加自定义回调
    # _CMD_CALLBACK_DICT = blivedm.BaseHandler._CMD_CALLBACK_DICT.copy()
    #
    # # 看过数消息回调
    # def __watched_change_callback(self, client: blivedm.BLiveClient, command: dict):
    #     print(f'[{client.room_id}] WATCHED_CHANGE: {command}')
    # _CMD_CALLBACK_DICT['WATCHED_CHANGE'] = __watched_change_callback  # noqa

    def _on_heartbeat(self, client: blivedm.BLiveClient, message: web_models.HeartbeatMessage):
        print(f'[{client.room_id}] 心跳')

    def _on_danmaku(self, client: blivedm.BLiveClient, message: web_models.DanmakuMessage):
        print(f'[{client.room_id}] {message.uname}：{message.msg}')

    def _on_gift(self, client: blivedm.BLiveClient, message: web_models.GiftMessage):
        print(f'[{client.room_id}] {message.uname} 赠送{message.gift_name}x{message.num}'
              f' （{message.coin_type}瓜子x{message.total_coin}）')

    # def _on_buy_guard(self, client: blivedm.BLiveClient, message: web_models.GuardBuyMessage):
    #     print(f'[{client.room_id}] {message.username} 上舰，guard_level={message.guard_level}')

    def _on_user_toast_v2(self, client: blivedm.BLiveClient, message: web_models.UserToastV2Message):
        print(f'[{client.room_id}] {message.username} 上舰，guard_level={message.guard_level}')

    def _on_super_chat(self, client: blivedm.BLiveClient, message: web_models.SuperChatMessage):
        print(f'[{client.room_id}] 醒目留言 ¥{message.price} {message.uname}：{message.message}')

    # def _on_interact_word_v2(self, client: blivedm.BLiveClient, message: web_models.InteractWordV2Message):
    #     if message.msg_type == 1:
    #         print(f'[{client.room_id}] {message.username} 进入房间')


# -------- AI Town presence importer --------
def _parse_room_id(raw: str) -> int:
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


ROOM_ID_ENV = os.environ.get('ROOM_ID', '0')
ROOM_ID = _parse_room_id(sys.argv[1]) if len(sys.argv) > 1 else _parse_room_id(ROOM_ID_ENV)
# 默认指向当前 dev 域名，可用环境变量覆盖
AI_TOWN_SERVER = os.environ.get('AI_TOWN_SERVER', 'https://judicious-scorpion-568.convex.cloud')
AI_TOWN_MUTATION = os.environ.get(
    'AI_TOWN_MUTATION', '/api/mutation/aiTown/agentOperations:presenceSyncMutation'
)
DEBUG_POST = os.environ.get('AI_TOWN_DEBUG', '0') == '1'
POST_INTERVAL_SECONDS = 2.0
FLUSH_INTERVAL_SECONDS = 0.25
EXIT_SECONDS = float(os.environ.get('AI_TOWN_EXIT_SECONDS', '120'))

PENDING_ENTER: Set[str] = set()
LAST_SEEN: dict[str, float] = {}
LAST_POST: float = 0.0


def _mutation_url():
    if AI_TOWN_MUTATION.startswith('http://') or AI_TOWN_MUTATION.startswith('https://'):
        return AI_TOWN_MUTATION
    return f'{AI_TOWN_SERVER.rstrip("/")}{AI_TOWN_MUTATION}'


def _add_name(name: str):
    cleaned = (name or '').strip()
    if cleaned:
        now = time.time()
        LAST_SEEN[cleaned] = now
        PENDING_ENTER.add(cleaned)


def _collect_leaves(now: float):
    leaves: list[str] = []
    for uname, ts in list(LAST_SEEN.items()):
        if now - ts > EXIT_SECONDS:
            leaves.append(uname)
            LAST_SEEN.pop(uname, None)
    return leaves


class PresenceHandler(handlers.BaseHandler):
    def _on_interact_word_v2(self, client, message):
        # msg_type==1 is enter room
        if getattr(message, 'msg_type', None) == 1:
            _add_name(message.username)

    def _on_danmaku(self, client, message):
        _add_name(message.uname)

    def _on_open_live_danmaku(self, client, message):
        _add_name(message.uname)

    def _on_open_live_enter_room(self, client, message):
        _add_name(message.uname)


async def post_batch(session: aiohttp.ClientSession):
    global LAST_POST
    now = time.time()
    leaves = _collect_leaves(now)
    enters = list(PENDING_ENTER)
    if not enters and not leaves:
        LAST_POST = now
        return
    if enters:
        PENDING_ENTER.clear()
    LAST_POST = now
    try:
        payload = {'args': {'enter': enters, 'leave': leaves}}
        url = _mutation_url()
        async with session.post(url, json=payload) as resp:
            body = await resp.text()
            if resp.status >= 400 or DEBUG_POST:
                print(f'presenceSyncMutation POST {url} payload={payload} status={resp.status} body={body}')
    except Exception as e:
        print(f'Failed to post presence batch: {e}')


async def presence_flush_loop(session: aiohttp.ClientSession):
    try:
        while True:
            await asyncio.sleep(FLUSH_INTERVAL_SECONDS)
            if time.time() - LAST_POST >= POST_INTERVAL_SECONDS:
                await post_batch(session)
    finally:
        await post_batch(session)


async def run_presence_importer(room_id: int):
    if room_id <= 0:
        raise SystemExit('ROOM_ID required for presence import')
    async with aiohttp.ClientSession() as http_session:
        client = blivedm.BLiveClient(room_id, session=http_session)
        client.set_handler(PresenceHandler())
        client.start()
        flush_task = asyncio.create_task(presence_flush_loop(http_session))
        try:
            await client.join()
        finally:
            client.stop()
            flush_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await flush_task
            await post_batch(http_session)
            await client.stop_and_close()


if __name__ == '__main__':
    if ROOM_ID > 0:
        asyncio.run(run_presence_importer(ROOM_ID))
    else:
        asyncio.run(main())
