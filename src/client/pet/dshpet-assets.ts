/**
 * dsh-pet ("大肥鱼") theme: dsh-pet webm animations (640x360, alpha) mapped to
 * pet statuses. Served as separate static files by the host and rendered as
 * looping <video>, so each is only downloaded when first shown and then cached.
 */
import type { PetTheme, Sprite } from './themes.ts'

const ASSET_BASE = '/session-desk/assets/pet'
const video = (name: string): Sprite => ({ type: 'video', src: `${ASSET_BASE}/${name}` })

const idlePool: Sprite[] = [
  video('daiji-huxi-xiuxian.webm'),
  video('dongzhangxiwang.webm'),
  video('youxian-hengga.webm'),
  video('chaoda-shenlanyao.webm'),
  video('haqian-liantian.webm'),
  video('yuandi-zhuanxin-wan-mofang.webm'),
  video('yuandi-qiaoji-zhuomian-hudong.webm'),
  video('yuandi-zhongli-xiadun-yasuo.webm'),
  video('yuandi-xiaoqi-chenmian.webm'),
  video('yuandi-dunxia-wan-wanju-qiche.webm'),
  video('jingyu-tu-paopao-texiao.webm'),
  video('nvpu-quxi-liyi.webm'),
  video('beixiayitiao-zhamao.webm'),
  video('yuandi-tiaoyue-zhuasui-touding-wupin.webm'),
  video('xiaofudu-yuandi-360du-xuanzhuan-zhanshi.webm'),
  video('touchi-lingshi-bei-zhuazhu.webm'),
  video('wan-youxi-qijibaituai.webm'),
  video('yong-jingyu-weiba-paidadi.webm'),
  video('da-keshui-bei-jingxing.webm'),
  video('wan-shuiqiang.webm'),
  video('xiaotiqin-yanzou.webm'),
  video('lanjing-xianshi.webm'),
  video('chi-baifan.webm'),
  video('zhao-jingzi.webm'),
  video('youya-nvpuwu.webm'),
  video('qingkuai-yaobaiwu.webm'),
  video('keai-zhaiwu.webm'),
  video('zhengti-huanzhuang-shise.webm'),
  video('dakou-chi-lingshi.webm'),
  video('chui-qiqiu.webm'),
  video('dongwu-huanrao.webm'),
  video('shendu-sikao-suisuinian.webm'),
  video('qingkuai-jilu.webm'),
  video('xie-daima.webm'),
  video('beiluoye-yanmo.webm'),
  video('beishubiao-tuozhuai-xuankong-fankui.webm'),
  video('chi-bingqilin-ronghua.webm'),
  video('chi-token.webm'),
  video('chi-wancan.webm'),
  video('chi-wucan.webm'),
  video('chi-zaocan.webm'),
  video('dianji-huiying-aojiao-shengqi-ceshen-zhanshi.webm'),
  video('dianji-huiying-haixiu-jingya.webm'),
  video('dianji-huiying-kaixin-yuedong.webm'),
  video('duixueren.webm'),
  video('fang-fengzheng.webm'),
  video('pangxie-zoulu.webm'),
  video('yaoshan-naliang.webm'),
  video('yuandi-piaofu-tabu.webm'),
  video('yuandi-zuozhuan-benpao.webm'),
  video('zhongqiu-shangyue-chi-yuebing.webm'),
]

export const dshpetTheme: PetTheme = {
  id: 'dshpet',
  label: '大肥鱼',
  aspect: 16 / 9,
  idlePool,
  busy: {
    running: video('xie-daima.webm'),
    error: video('beixiayitiao-zhamao.webm'),
    awaiting: video('dongzhangxiwang.webm'),
    subagent: video('dongwu-huanrao.webm'),
  },
  reactions: [
    video('dianji-huiying-aojiao-shengqi-ceshen-zhanshi.webm'),
    video('dianji-huiying-haixiu-jingya.webm'),
    video('dianji-huiying-kaixin-yuedong.webm'),
  ],
}
