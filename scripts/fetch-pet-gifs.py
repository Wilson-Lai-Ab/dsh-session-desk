#!/usr/bin/env python3
"""Download the original dsh-pet preview GIFs (MIT) verbatim into the plugin.

The host serves them from ``lib/assets/pet/`` (copied by build.mjs), so the
browser loads each GIF lazily and caches it. No resizing/optimisation here —
originals are 220x124 and crisp at every pet size.
"""
import os
import sys
import urllib.request

BASE = "https://raw.githubusercontent.com/PC2005-cloud/dsh-pet/main/dsh-pet/assets/preview/"
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "client", "pet", "assets")

NAMES = [
    "beiluoye-yanmo.gif", "beishubiao-tuozhuai-xuankong-fankui.gif",
    "beixiayitiao-zhamao.gif", "chaoda-shenlanyao.gif", "chi-baifan.gif",
    "chi-bingqilin-ronghua.gif", "chi-token.gif", "chi-wancan.gif",
    "chi-wucan.gif", "chi-zaocan.gif", "chui-qiqiu.gif",
    "da-keshui-bei-jingxing.gif", "daiji-huxi-xiuxian.gif",
    "dakou-chi-lingshi.gif", "dianji-huiying-aojiao-shengqi-ceshen-zhanshi.gif",
    "dianji-huiying-haixiu-jingya.gif", "dianji-huiying-kaixin-yuedong.gif",
    "dongwu-huanrao.gif", "dongzhangxiwang.gif", "duixueren.gif",
    "fang-fengzheng.gif", "haqian-liantian.gif", "jingyu-tu-paopao-texiao.gif",
    "keai-zhaiwu.gif", "lanjing-xianshi.gif", "nvpu-quxi-liyi.gif",
    "pangxie-zoulu.gif", "qingkuai-jilu.gif", "qingkuai-yaobaiwu.gif",
    "shendu-sikao-suisuinian.gif", "touchi-lingshi-bei-zhuazhu.gif",
    "wan-shuiqiang.gif", "wan-youxi-qijibaituai.gif",
    "xiaofudu-yuandi-360du-xuanzhuan-zhanshi.gif", "xiaotiqin-yanzou.gif",
    "xie-daima.gif", "yaoshan-naliang.gif", "yong-jingyu-weiba-paidadi.gif",
    "youxian-hengga.gif", "youya-nvpuwu.gif", "yuandi-dunxia-wan-wanju-qiche.gif",
    "yuandi-piaofu-tabu.gif", "yuandi-qiaoji-zhuomian-hudong.gif",
    "yuandi-tiaoyue-zhuasui-touding-wupin.gif", "yuandi-xiaoqi-chenmian.gif",
    "yuandi-zhongli-xiadun-yasuo.gif", "yuandi-zhuanxin-wan-mofang.gif",
    "yuandi-zuozhuan-benpao.gif", "zhao-jingzi.gif",
    "zhengti-huanzhuang-shise.gif", "zhongqiu-shangyue-chi-yuebing.gif",
]


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    names = [only] if only else NAMES
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for name in names:
        dst = os.path.join(OUT, name)
        print(f"download {name}", flush=True)
        urllib.request.urlretrieve(BASE + name, dst)
        size = os.path.getsize(dst)
        total += size
        print(f"  {name}: {size} bytes", flush=True)
    print(f"TOTAL: {total} bytes", flush=True)


if __name__ == "__main__":
    main()
