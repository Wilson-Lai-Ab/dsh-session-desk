#!/usr/bin/env python3
"""Download dsh-pet webm animations (640x360, alpha) with pinyin filenames.

The source thumbnails use Chinese names; we rename to the same pinyin stems as
the GIF previews so the plugin URL scheme stays ASCII-only.
"""
import os
import time
import urllib.parse
import urllib.request

BASE = "https://raw.githubusercontent.com/PC2005-cloud/dsh-pet/main/dsh-pet/assets/thumb/"
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "client", "pet", "assets")

# (Chinese source filename, pinyin destination filename)
MAP = [
    ("东张西望.webm", "dongzhangxiwang.webm"),
    ("中秋赏月吃月饼.webm", "zhongqiu-shangyue-chi-yuebing.webm"),
    ("优雅女仆舞.webm", "youya-nvpuwu.webm"),
    ("偷吃零食被抓住.webm", "touchi-lingshi-bei-zhuazhu.webm"),
    ("写代码.webm", "xie-daima.webm"),
    ("动物环绕.webm", "dongwu-huanrao.webm"),
    ("原地专心玩魔方.webm", "yuandi-zhuanxin-wan-mofang.webm"),
    ("原地小憩沉眠.webm", "yuandi-xiaoqi-chenmian.webm"),
    ("原地左转奔跑.webm", "yuandi-zuozhuan-benpao.webm"),
    ("原地敲击桌面互动.webm", "yuandi-qiaoji-zhuomian-hudong.webm"),
    ("原地漂浮踏步.webm", "yuandi-piaofu-tabu.webm"),
    ("原地跳跃抓碎头顶物品.webm", "yuandi-tiaoyue-zhuasui-touding-wupin.webm"),
    ("原地蹲下玩玩具汽车.webm", "yuandi-dunxia-wan-wanju-qiche.webm"),
    ("原地重力下蹲压缩.webm", "yuandi-zhongli-xiadun-yasuo.webm"),
    ("可爱宅舞.webm", "keai-zhaiwu.webm"),
    ("吃Token.webm", "chi-token.webm"),
    ("吃冰淇淋融化.webm", "chi-bingqilin-ronghua.webm"),
    ("吃午餐.webm", "chi-wucan.webm"),
    ("吃早餐.webm", "chi-zaocan.webm"),
    ("吃晚餐.webm", "chi-wancan.webm"),
    ("吃白饭.webm", "chi-baifan.webm"),
    ("吹气球.webm", "chui-qiqiu.webm"),
    ("哈欠连天.webm", "haqian-liantian.webm"),
    ("堆雪人.webm", "duixueren.webm"),
    ("大口吃零食.webm", "dakou-chi-lingshi.webm"),
    ("女仆屈膝礼仪.webm", "nvpu-quxi-liyi.webm"),
    ("小幅度原地 360 度旋转展示.webm", "xiaofudu-yuandi-360du-xuanzhuan-zhanshi.webm"),
    ("小提琴演奏.webm", "xiaotiqin-yanzou.webm"),
    ("待机呼吸休闲.webm", "daiji-huxi-xiuxian.webm"),
    ("悠闲哼歌.webm", "youxian-hengga.webm"),
    ("打瞌睡被惊醒.webm", "da-keshui-bei-jingxing.webm"),
    ("摇扇纳凉.webm", "yaoshan-naliang.webm"),
    ("放风筝.webm", "fang-fengzheng.webm"),
    ("整体换装试色.webm", "zhengti-huanzhuang-shise.webm"),
    ("深度思考碎碎念.webm", "shendu-sikao-suisuinian.webm"),
    ("点击回应 - 傲娇生气（侧身展示）.webm", "dianji-huiying-aojiao-shengqi-ceshen-zhanshi.webm"),
    ("点击回应 - 害羞惊讶.webm", "dianji-huiying-haixiu-jingya.webm"),
    ("点击回应 - 开心跃动.webm", "dianji-huiying-kaixin-yuedong.webm"),
    ("照镜子.webm", "zhao-jingzi.webm"),
    ("玩水枪.webm", "wan-shuiqiang.webm"),
    ("玩游戏气急败坏.webm", "wan-youxi-qijibaituai.webm"),
    ("用鲸鱼尾巴拍打地面.webm", "yong-jingyu-weiba-paidadi.webm"),
    ("蓝鲸现世.webm", "lanjing-xianshi.webm"),
    ("螃蟹走路.webm", "pangxie-zoulu.webm"),
    ("被吓一跳（炸毛）.webm", "beixiayitiao-zhamao.webm"),
    ("被落叶淹没.webm", "beiluoye-yanmo.webm"),
    ("被鼠标拖拽悬空反馈.webm", "beishubiao-tuozhuai-xuankong-fankui.webm"),
    ("超大伸懒腰.webm", "chaoda-shenlanyao.webm"),
    ("轻快摇摆舞.webm", "qingkuai-yaobaiwu.webm"),
    ("轻快记录.webm", "qingkuai-jilu.webm"),
    ("鲸鱼吐泡泡特效.webm", "jingyu-tu-paopao-texiao.webm"),
]


def fetch(url, dst, tries=8):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = resp.read()
            with open(dst, "wb") as fh:
                fh.write(data)
            return len(data)
        except Exception as exc:  # noqa: BLE001 - retry loop
            print(f"  retry {i + 1}: {exc}", flush=True)
            time.sleep(2)
    return -1


def main():
    os.makedirs(OUT, exist_ok=True)
    total = 0
    failed = []
    for zh, py in MAP:
        url = BASE + urllib.parse.quote(zh)
        dst = os.path.join(OUT, py)
        size = fetch(url, dst)
        if size < 0:
            failed.append(py)
            print(f"FAILED {py}", flush=True)
        else:
            total += size
            print(f"OK {py} {size}", flush=True)
    print(f"TOTAL {total} bytes, failed={failed}", flush=True)


if __name__ == "__main__":
    main()
