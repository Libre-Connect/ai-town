# -*- coding: utf-8 -*-
import asyncio
import http.cookies
import random
from typing import *

import aiohttp

import blivedm
import blivedm.models.web as web_models

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


if __name__ == '__main__':
    asyncio.run(main())
import os, sys, time, requests
from blivedm.blive import BLiveClient
from blivedm import models, handlers

ROOM_ID = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('ROOM_ID', '0'))
SERVER = os.environ.get('AI_TOWN_SERVER', 'http://localhost:3000')
PATH = os.environ.get('AI_TOWN_PATH', '/presence_import')

BATCH = set()
LAST_POST = 0

class H(handlers.BaseHandler):
    async def on_interact_word(self, msg: models.InteractWordMessage):
        uname = msg.uname.strip()
        if uname:
            BATCH.add(uname)

    async def on_danmaku(self, msg: models.DanmakuMessage):
        uname = msg.uname.strip()
        if uname:
            BATCH.add(uname)

def post_batch():
    global LAST_POST
    if BATCH:
        try:
            requests.post(SERVER + PATH, json={'names': list(BATCH)})
        except Exception:
            pass
        BATCH.clear()
    LAST_POST = time.time()

if __name__ == '__main__':
    if not ROOM_ID:
        raise SystemExit('ROOM_ID required')
    client = BLiveClient(ROOM_ID)
    client.set_handler(H())
    client.start()
    while True:
        if time.time() - LAST_POST > 2:
            post_batch()
        time.sleep(0.2)
