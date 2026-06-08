"""
🧠 私人心理老师 MindGuide
综合素质创新项目 - 完整原型
"""
import streamlit as st
import pandas as pd
import plotly.graph_objects as go
import plotly.express as px
from datetime import datetime
import random
import re

st.set_page_config(page_title="🧠 心理老师 MindGuide", layout="wide", page_icon="🧠")

# ── 自定义 CSS ──
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700&display=swap');
html, body, [class*="css"] { font-family: 'Noto Sans SC', sans-serif; }
.stApp { background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%); }
.main > div { padding: 0 2rem; }
.chat-msg { padding: 1rem 1.2rem; border-radius: 16px; margin: 0.5rem 0; max-width: 85%; line-height: 1.7; }
.user-msg { background: #e3f2fd; margin-left: auto; border-bottom-right-radius: 4px; }
.assistant-msg { background: white; margin-right: auto; border-bottom-left-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
.school-tag { display: inline-block; padding: 0.15rem 0.6rem; border-radius: 12px; font-size: 0.75rem; margin-left: 0.5rem; }
.cbt-tag { background: #e8f5e9; color: #2e7d32; }
.hu-tag { background: #fff3e0; color: #e65100; }
.pp-tag { background: #e8eaf6; color: #283593; }
mi-tag { background: #fce4ec; color: #c62828; }
.block-container { max-width: 1200px !important; }
h1, h2, h3 { font-weight: 500; }
div[data-testid="stSidebar"] { background: rgba(255,255,255,0.85); backdrop-filter: blur(10px); }
.stTabs [data-baseweb="tab-list"] { gap: 8px; }
.stTabs [data-baseweb="tab"] { border-radius: 8px 8px 0 0; padding: 8px 20px; }
</style>
""", unsafe_allow_html=True)

# ── 初始化 Session State ──
if "init" not in st.session_state:
    st.session_state.init = True
    st.session_state.messages = []
    st.session_state.school = "人本主义"
    st.session_state.mode = "💬 自由倾诉"
    st.session_state.emotion_log = []
    st.session_state.knowledge_points = set()
    st.session_state.soul_analysis = ""
    st.session_state.chat_count = 0
    st.session_state.welcome_shown = False

# ── 心理学流派风格定义 ──
SCHOOLS = {
    "认知行为 (CBT)": {
        "icon": "🧠", "color": "#2e7d32", "bg": "#e8f5e9",
        "style": "理性分析",
        "desc": "关注思维模式，用结构化方法识别和调整不合理认知",
        "tags": ["证据检验", "认知重构", "行为实验", "思维记录"],
        "opener": "让我们一起来分析一下你面临的情况。你可以先描述一下具体发生了什么，然后我们看看这背后有什么自动思维？"
    },
    "人本主义": {
        "icon": "🌱", "color": "#e65100", "bg": "#fff3e0",
        "style": "共情陪伴",
        "desc": "相信每个人都有自我实现的潜能，提供无条件的积极关注",
        "tags": ["共情理解", "积极关注", "真诚一致", "自我实现"],
        "opener": "欢迎你来到这里。无论你带来什么，这里都是一个安全的空间。我准备好倾听你的故事了。"
    },
    "积极心理学": {
        "icon": "✨", "color": "#283593", "bg": "#e8eaf6",
        "style": "优势赋能",
        "desc": "聚焦优势与幸福，帮助人 flourish（蓬勃发展）",
        "tags": ["品格优势", "心流体验", "成长思维", "感恩练习"],
        "opener": "太好了，又到了成长的时刻！让我们发现你身上那些闪闪发光的优势吧。今天想探索什么话题？"
    },
    "正念·接纳": {
        "icon": "☯️", "color": "#c62828", "bg": "#fce4ec",
        "style": "觉知接纳",
        "desc": "培养对当下的觉察，学习与不适情绪共处而非对抗",
        "tags": ["正念觉察", "接纳承诺", "认知解离", "当下力量"],
        "opener": "让我们先做三次深呼吸……好。现在，无论你心中有什么，都欢迎它。我们不需要改变什么，只是观察。"
    }
}

# ── 回复生成器（无需 API，基于流派模板）──
RESPONSE_TEMPLATES = {
    "焦虑": {
        "认知行为 (CBT)": "我注意到你提到了'焦虑'。在CBT视角下，焦虑往往源于对未来的**灾难化预测**。\n\n让我们做个简单的练习：\n1️⃣ **证据是什么？** — 你担心的结果实际发生的概率有多大？\n2️⃣ **最坏情况** — 如果发生了，你能如何应对？\n3️⃣ **替代视角** — 有没有其他更合理的可能性？\n\n试试看，把你的想法写下来，我们一起审视它。",
        "人本主义": "焦虑是一种很人性化的体验。它告诉我们某些东西对我们很重要。\n\n在这份焦虑背后，我感受到你对自己、对生活的在意。**允许自己感受到它**，不需要急着赶走它。\n\n你可以把手放在胸口，对自己说：'此刻我感到焦虑，这没关系。我是安全的。' 我就在这里，陪着你。",
        "积极心理学": "焦虑其实是一个信号——它说明你在乎的事情超出了你当前感知到的应对能力。这是**成长的前奏**！\n\n想想看：\n💪 你过去克服焦虑时，用到了什么**内在优势**？\n🎯 把'我好焦虑'换成'我兴奋，我准备好了'，能量会有什么不同？\n📈 焦虑说明你在拓展舒适区，这是成长的必经之路！",
        "正念·接纳": "让我们先停下来，花10秒感受焦虑在身体的哪个部位……\n\n☯️ 焦虑只是你当下体验的一部分，不是你全部的自己。想象焦虑是天空中的乌云，而你是整片天空——乌云会来，也会去。\n\n**练习**：对焦虑说三次'我看见你了，欢迎你'，观察它的变化。"
    },
    "压力": {
        "认知行为 (CBT)": "压力来自于我们对情境的**认知评估**——当我们认为'要求超过了资源'时压力就产生了。\n\n来看看你的压力公式：\n📊 **客观要求 vs 你感知的资源** — 哪个被放大了？\n🔍 **哪些'必须'和'应该'在驱动你？**\n\n有时候改变认知比改变环境更快。",
        "人本主义": "你承载了很多。真正让我关心的是——**你对自己是否也像对别人那样温柔？**\n\n在追求的路上，别忘了你首先是一个人，有自己的极限和需要。\n\n你的价值不在于你完成了多少事。'存在'本身就值得被看见。",
        "积极心理学": "压力≠坏事！耶克斯-多德森定律告诉我们：**适度的压力能带来最佳表现**。\n\n关键是要找到你的'最佳压力区'：\n⚡ 压力过低 → 无聊\n⚡ 压力适中 → 心流\n⚡ 压力过高 → 耗竭\n\n你现在的压力在哪一档？我们可以一起调整到最佳状态！",
        "正念·接纳": "做三次深呼吸……吸气……呼气……\n\n☯️ 压力常常来自于对'未来'的担心，或是固着在'过去'。而此刻——仅仅此刻——你是安全的。\n\n试试这个：把注意力从'要做完所有事'转移到'我正在做一件事'。",
    },
    "人际关系": {
        "认知行为 (CBT)": "人际关系困扰常涉及一些**核心信念**，比如'我不够好'或'别人会拒绝我'。\n\n📝 试试这个思维记录表：\n情境 → 自动思维 → 情绪 → 支持证据 → 反对证据 → 替代思维\n\n你人际中反复出现的模式是什么？我们可以先从一个具体场景入手。",
        "人本主义": "每个人内心深处都渴望被理解和接纳。关系中最好的礼物是**真诚的陪伴**。\n\n卡尔·罗杰斯说：'当一个人被理解和接纳时，他才有可能改变。' 你不需要完美才值得被爱。\n\n你想聊聊具体的关系困扰吗？",
        "积极心理学": "健康的关系是幸福最重要的支柱之一！研究发现：**深厚的联结 > 广泛的社交**。\n\n💡 试试'积极回应'练习：当对方分享好消息时，给予热情且具体的回应，这会极大增强关系质量。\n\n你身边有没有那个你特别想感谢的人？",
        "正念·接纳": "关系中大部分的痛苦来自于'期待'——期待对方以某种方式回应。\n\n☯️ 试试'关系正念'：下次和对方交流时，放下手机，全然地倾听，不急着回应或评判。只是听。\n\n你会发现：当你不再试图改变对方时，关系反而更轻松了。",
    },
    "自我成长": {
        "认知行为 (CBT)": "成长来自于对**限制性信念**的持续挑战。\n\n哪些'我不能……''我不擅长……''我永远……'在限制你？把它们写下来，然后我们逐个检验。\n\n记住：想法≠事实。",
        "人本主义": "马斯洛说：'人不是一张白纸，而是一颗种子，有朝向成长的先天倾向。'\n\n你此刻想要成长，这个意愿本身就很珍贵。**成长不需要成为别人，而是成为更真实的自己**。\n\n你觉得现在的自己，哪些部分正在等待被看见？",
        "积极心理学": "太好了！成长是我最喜欢的主题！🌟\n\n根据PETERSON的研究，使用你的**标志性优势**是成长最快的方式。\n\n来做个快速探索：\n1. 什么活动让你忘记时间？\n2. 别人最常夸你什么？\n3. 做什么事让你充满能量？\n\n答案里就藏着你的优势！",
        "正念·接纳": "有时候，成长不是要'变得更好'，而是**更全然地接纳当下的自己**。\n\n当你不再抗拒自己的不完美时，变化反而自然发生了。\n\n就像种花——你不能拽着它长大，只能提供土壤、阳光和水，然后等待。",
    },
    "情绪低落": {
        "认知行为 (CBT)": "情绪低落常常伴随着**负面认知三联征**：对自我、世界和未来的消极看法。\n\n🔍 行为激活是CBT中非常有效的方法：\n列出几件小事（起床→散步→洗澡→做饭），每完成一件打个✅\n\n行动本身，哪怕很小，也能改变情绪。今天可以尝试哪一件？",
        "人本主义": "我听到你感到低落。谢谢你信任我，愿意分享这份感受。\n\n你不需要强装开心。**悲伤有它存在的权利**，它可能是你的内心在告诉你：有些东西需要被看见、被哀悼。\n\n我会在这里陪你。",
        "积极心理学": "低落的情绪不是敌人——它像是你内心的一个信号灯。\n\n💡 试试'三件好事'练习：每天睡前写下今天的三件好事（无论多小）和它们发生的原因。连续一周，情绪会有明显改善。\n\n你愿意试试看吗？",
        "正念·接纳": "☯️ 低落的感觉此刻就在这里，像一片乌云。不需要推开它，也不需要分析它。\n\n只是观察：'哦，这是低落，它来了。' 然后把手放在心上，温柔地说：'我知道你在，没关系。'\n\n情绪是访客，你不是你的情绪。",
    }
}

FALLBACK_RESPONSES = {
    "认知行为 (CBT)": [
        "你提出了一个很好的话题。让我用CBT的框架来帮你梳理。\n\n首先，我们可以把它拆解成三个层面：\n1️⃣ **客观情境** — 发生了什么？\n2️⃣ **你的想法/解读** — 你对自己说了什么？\n3️⃣ **情绪和行为反应** — 你因此感受到了什么、做了什么？\n\n很多时候，改变想法就能改变感受。你想从哪个层面开始探索？",
        "感谢你的分享。在CBT中，我们关注的是'想法→情绪→行为'这个链条。\n\n🔍 你刚才说的内容里，我注意到可能有这样一个模式：\n→ 某个情境发生\n→ 你产生了一个自动思维\n→ 然后引发了某种情绪\n\n你能试着把这个链条拆解一下吗？",
        "好，那我们从识别'自动思维'开始。\n\n自动思维是那些一闪而过的、不经意的想法，它们常常不合理但我们却深信不疑。\n\n💡 比如：'我肯定做不好' → 这是一种'预测式思维'。\n\n你最近有没有类似这样的自动思维？我们可以一起检验它。",
        "来做个简单的CBT练习：\n📝 **想法记录表**\n\n情境：________\n自动思维：________\n情绪（0-10分）：________\n支持证据：________\n反对证据：________\n替代思维：________\n\n你想从哪个部分开始写？"
    ],
    "人本主义": [
        "谢谢你愿意在这里分享。我感受到你在真诚地探索自己的内心。\n\n在这里，你不用急着解决问题，也不用扮演任何角色。无论你说什么，我都会以尊重的态度去倾听和理解。\n\n也许你可以先说说，你此刻最想被理解的是什么？",
        "我听到你了。在这个空间里，你说什么都可以，不用顾虑。\n\n人本主义心理学相信：**你才是自己生活的专家**。我的角色不是告诉你该怎么做，而是陪你一起探索，帮你听到自己内心的声音。\n\n你现在心里最先浮现的是什么？",
        "欢迎来到这里。每个人内心都有成长的种子，只要有合适的土壤——理解和接纳——它就会自然生长。\n\n我想为你创造这样的土壤。你可以自由地表达，不用伪装，不用担心被评判。\n\n今天你想聊点什么？",
        "我珍视你此刻在这里的每一刻。\n\n卡尔·罗杰斯说过：'当一个人被理解和接纳时，他才有可能改变。' 无论你带来什么，我都会以真诚和尊重的态度陪伴你。\n\n你要从哪里开始？"
    ],
    "积极心理学": [
        "这是一个很好的探索方向！💫\n\n在积极心理学中，我们相信每个人都有自己的独特优势。与其纠结缺点，不如放大优势。\n\n我想邀请你做一个小思考：在你的生活中，什么时候你的感觉最好？那时候你在做什么？和谁在一起？",
        "太棒了，感谢你的分享！🌟\n\n积极心理学之父塞利格曼提出：持久幸福来自于**发挥你的标志性优势**。\n\n我们来做个小探索——你觉得以下哪几个词最符合你？\n• 好奇心 • 创造力 • 勇敢 • 善良 • 领导力 • 公正 • 自律 • 感恩\n\n或者说说你心中自己的优势是什么？",
        "你知道吗，研究告诉我们：每天记录'三件好事'，连续一周，幸福指数能提升好几个点！📈\n\n不是因为事情变好了，而是因为你训练大脑去**注意积极的事物**。\n\n你愿意的话，我们可以从今天就开始这个练习。",
        "欢迎来到积极心理学的时间！✨\n\n我们的关注点不是'你有什么问题'，而是'**什么让你蓬勃生长**'。\n\n想象一下——如果你每天都能量满满、充满意义感，那时的你在做什么？我们往那个方向聊聊。"
    ],
    "正念·接纳": [
        "在我们深入之前，我想邀请你做一个小小的练习：\n\n🫁 花三秒钟……慢慢地吸气……\n🫁 再花四秒钟……缓缓地呼气……\n\n好。现在，不带评判地观察你此刻的想法——就像看云朵飘过天空。你注意到了什么？",
        "让我们先做一个1分钟的静观练习：\n\n☯️ 感受你双脚踩在地上的感觉\n☯️ 感受你呼吸时胸口的起伏\n☯️ 留意你听到的声音……不需要命名它们，只是听\n\n你现在感觉怎么样？",
        "☯️ 正念的核心不是'清空头脑'，而是**带着善意地觉察当下**。\n\n无论你现在有什么感受——焦虑、平静、烦躁、或者说不清——都欢迎它。不需要改变什么，只是觉察。\n\n你想试试一个简短的引导练习吗？",
        "在接纳承诺疗法（ACT）中，我们常说：'你不是你的想法，你是看到想法的那个人。'\n\n想象你的想法是天空中的云——有的黑、有的白、有的很大——但**你是整片天空**，云会来也会去。\n\n你最近有观察到哪些'云'吗？"
    ]
}

# ── 辅助函数 ──

def get_school_key(name):
    for k in SCHOOLS:
        if k.startswith(name) or name in k:
            return k
    return "人本主义"

def analyze_soul(user_input):
    """模拟 SOUL 框架分析"""
    s_emotion = "平静"
    if any(w in user_input for w in ["焦虑", "担心", "害怕", "紧张", "不安"]):
        s_emotion = "焦虑"
    elif any(w in user_input for w in ["难过", "伤心", "低落", "孤独", "悲伤", "抑郁"]):
        s_emotion = "低落"
    elif any(w in user_input for w in ["生气", "愤怒", "烦躁", "不爽", "烦"]):
        s_emotion = "烦躁"
    elif any(w in user_input for w in ["开心", "高兴", "激动", "兴奋", "快乐"]):
        s_emotion = "积极"
    return {
        "S - 情境感知": f"检测到用户情绪状态偏向「{s_emotion}」，话题涉及个人感受表达",
        "O - 专业观察": f"关键词'{user_input[:6]}…'反映出用户在主动寻求理解和支持",
        "U - 共情理解": "以先接纳感受为优先，避免直接给建议",
        "L - 学习成长": f"适合引入{'情绪认知' if s_emotion!='积极' else '优势识别'}相关知识点"
    }

def generate_response(user_input, school_name):
    """根据用户输入和选择的流派生成回复"""
    # 尝试直接匹配主题词
    for topic, responses in RESPONSE_TEMPLATES.items():
        if topic in user_input:
            if school_name in responses:
                return responses[school_name]
    # 尝试关键词匹配
    keywords = {
        "焦虑": ["焦虑", "担心", "紧张", "不安", "慌", "睡不着", "失眠", "考试", "面试", "害怕", "恐惧", "心慌"],
        "压力": ["压力", "累", "好累", "忙", "崩溃", "太多", "喘不过气", "喘不上", "撑不住", "受不了", "顶不住", "疲惫", "疲劳"],
        "人际关系": ["朋友", "室友", "同学", "同事", "父母", "老师", "家人", "吵架", "矛盾", "沟通", "社交", "人际", "合不来", "被孤立", "孤独"],
        "自我成长": ["改变", "提升", "进步", "成长", "目标", "迷茫", "方向", "未来", "人生", "意义", "价值", "想变", "变得更好", "努力"],
        "情绪低落": ["难过", "伤心", "低落", "不开心", "难受", "想哭", "没劲", "没意思", "无聊", "空虚", "丧", "郁闷", "emo", "消沉"]
    }
    for topic, kws in keywords.items():
        if any(w in user_input for w in kws):
            if topic in RESPONSE_TEMPLATES and school_name in RESPONSE_TEMPLATES[topic]:
                return RESPONSE_TEMPLATES[topic][school_name]
    # 兜底回复（随机选择）
    fallbacks = FALLBACK_RESPONSES.get(school_name, FALLBACK_RESPONSES["人本主义"])
    return random.choice(fallbacks)

def record_emotion(user_input):
    """简单情绪记录"""
    score = 5
    if any(w in user_input for w in ["焦虑", "担心", "紧张", "不安", "慌"]):
        score = random.randint(3,5)
    elif any(w in user_input for w in ["难过", "伤心", "低落", "孤独", "悲伤"]):
        score = random.randint(2,4)
    elif any(w in user_input for w in ["生气", "愤怒", "烦躁"]):
        score = random.randint(3,4)
    elif any(w in user_input for w in ["开心", "高兴", "激动", "兴奋"]):
        score = random.randint(7,9)
    elif any(w in user_input for w in ["谢谢", "明白了", "好的", "有帮助"]):
        score = random.randint(6,8)
    st.session_state.emotion_log.append({
        "time": datetime.now().strftime("%H:%M"),
        "score": score,
        "label": "焦虑" if score <= 4 else ("中性" if score <= 6 else "积极")
    })

# ── 侧边栏 ──
with st.sidebar:
    st.markdown("## 🧠 MindGuide")
    st.markdown("*你的私人心理老师*")
    st.divider()

    st.markdown("### 🎯 模式选择")
    mode = st.radio("", ["💬 自由倾诉", "📚 心理学课堂"], label_visibility="collapsed")
    st.session_state.mode = mode

    st.divider()
    st.markdown("### 🎨 选择流派")
    st.caption("同一问题，不同视角")

    cols = st.columns(2)
    school_names = list(SCHOOLS.keys())
    for i, name in enumerate(school_names):
        s = SCHOOLS[name]
        with cols[i % 2]:
            if st.button(f"{s['icon']} {name.split('(')[0].strip()}",
                        use_container_width=True,
                        key=f"school_{i}"):
                st.session_state.school = name
                st.rerun()

    current = SCHOOLS[st.session_state.school]
    st.markdown(f"""
    <div style="background:{current['bg']};padding:0.8rem;border-radius:12px;margin-top:0.5rem;">
        <span style="font-weight:700;color:{current['color']};">{current['icon']} {st.session_state.school}</span><br>
        <span style="font-size:0.85rem;color:#555;">{current['style']} · {current['desc']}</span>
        <div style="margin-top:6px;">{" ".join(f'<span style="background:rgba(0,0,0,0.08);padding:1px 8px;border-radius:8px;font-size:0.75rem;margin:2px;">{t}</span>' for t in current['tags'][:3])}</div>
    </div>
    """, unsafe_allow_html=True)

    st.divider()
    st.markdown("### 📊 今日概况")
    if st.session_state.emotion_log:
        scores = [e["score"] for e in st.session_state.emotion_log]
        avg = sum(scores) / len(scores)
        st.metric("平均情绪分", f"{avg:.1f}/10",
                 delta=f"{'↑' if avg > 5.5 else '↓'} {'积极' if avg > 5.5 else '需要关注'}",
                 delta_color="normal")
        st.metric("对话轮次", len(st.session_state.messages) // 2 + 1)
        st.metric("已学知识点", len(st.session_state.knowledge_points))
    else:
        st.info("开始对话后，这里会显示你的成长数据 ✨")

    st.divider()
    st.markdown("""
    <div style="font-size:0.8rem;color:#888;text-align:center;">
        ⚠️ 本应用为教育演示项目<br>
        不能替代专业心理咨询<br>
        如有需要请拨打：<br>
        <strong>全国心理援助热线：<br>400-161-9995</strong>
    </div>
    """, unsafe_allow_html=True)

# ── 主界面 ──
tab1, tab2, tab3 = st.tabs(["💬 对话", "🔍 SOUL 分析", "📈 成长轨迹"])

# ===== TAB 1: 对话 =====
with tab1:
    school = SCHOOLS[st.session_state.school]

    # 标题区
    title = "💬 自由倾诉 · 安全空间" if st.session_state.mode == "💬 自由倾诉" else "📚 心理学课堂 · 今日学习"
    st.markdown(f"### {title}")
    mode_hint = "分享你的想法和感受，我会用心倾听" if "倾诉" in st.session_state.mode else "输入你想了解的心理学概念或问题"
    if "倾诉" in st.session_state.mode:
        st.caption(f"当前流派：**{school['icon']} {st.session_state.school}** · {school['style']} 取向 · {mode_hint}")
    else:
        st.caption(f"当前流派：**{school['icon']} {st.session_state.school}** · {school['style']} 取向 · {mode_hint}")

    # 聊天容器
    chat_container = st.container()
    with chat_container:
        if not st.session_state.messages:
            # 欢迎消息
            welcome = school["opener"]
            st.markdown(f"""
            <div class="chat-msg assistant-msg">
                <strong>{school['icon']} {st.session_state.school}老师</strong>
                <span class="school-tag {st.session_state.school.split('(')[0].split('·')[0].strip()}">刚刚</span><br>
                {welcome}
            </div>
            """, unsafe_allow_html=True)

        for msg in st.session_state.messages:
            if msg["role"] == "user":
                st.markdown(f'<div class="chat-msg user-msg"><strong>你</strong><br>{msg["content"]}</div>', unsafe_allow_html=True)
            else:
                tag_class = msg.get("school", "人本主义").split("(")[0].strip()
                st.markdown(f'''
                <div class="chat-msg assistant-msg">
                    <strong>{SCHOOLS.get(msg.get("school","人本主义"), SCHOOLS["人本主义"])["icon"]} {msg.get("school","人本主义")}老师</strong>
                    <span class="school-tag {tag_class}">{msg.get("style","")}</span><br>
                    {msg["content"]}
                </div>
                ''', unsafe_allow_html=True)

    # 输入区
    with st.form("chat_form", clear_on_submit=True):
        cols = st.columns([6, 1])
        with cols[0]:
            user_input = st.text_input("", placeholder="说说你的想法、感受或想问的问题...", label_visibility="collapsed")
        with cols[1]:
            submitted = st.form_submit_button("发送 ✨", use_container_width=True)

    if submitted and user_input:
        st.session_state.messages.append({"role": "user", "content": user_input})
        record_emotion(user_input)

        # 生成回复
        school_name = st.session_state.school
        response = generate_response(user_input, school_name)

        # 提取知识点
        for topic in RESPONSE_TEMPLATES.keys():
            if topic in response:
                st.session_state.knowledge_points.add(topic)

        # 保存 SOUL 分析
        st.session_state.soul_analysis = analyze_soul(user_input)

        st.session_state.messages.append({
            "role": "assistant",
            "content": response,
            "school": school_name,
            "style": SCHOOLS[school_name]["style"]
        })
        st.session_state.chat_count += 1
        st.rerun()

# ===== TAB 2: SOUL 分析 =====
with tab2:
    st.markdown("### 🔍 SOUL 对话分析框架")
    st.caption("每次对话后，系统会从四个层次分析交互")

    col_a, col_b = st.columns([1, 1])
    with col_a:
        st.markdown("""
        <div style="background:white;padding:1.2rem;border-radius:12px;margin-bottom:1rem;">
        <h4 style="margin:0 0 0.5rem;">📋 SOUL 框架说明</h4>
        <table style="width:100%;font-size:0.9rem;">
        <tr><td><strong>S</strong>ituation</td><td>情境感知</td><td>识别情绪状态和场景</td></tr>
        <tr><td><strong>O</strong>bservation</td><td>专业观察</td><td>心理学特征分析</td></tr>
        <tr><td><strong>U</strong>nderstanding</td><td>共情理解</td><td>先共情再建议</td></tr>
        <tr><td><strong>L</strong>earning</td><td>学习成长</td><td>知识点输出</td></tr>
        </table>
        </div>
        """, unsafe_allow_html=True)

    with col_b:
        st.markdown(f"""
        <div style="background:white;padding:1.2rem;border-radius:12px;margin-bottom:1rem;">
        <h4 style="margin:0 0 0.5rem;">🎯 当前流派：{st.session_state.school}</h4>
        <p style="font-size:0.9rem;color:#555;">{SCHOOLS[st.session_state.school]['desc']}</p>
        <p style="font-size:0.85rem;color:#888;">核心方法：{' · '.join(SCHOOLS[st.session_state.school]['tags'])}</p>
        </div>
        """, unsafe_allow_html=True)

    if st.session_state.soul_analysis:
        st.divider()
        st.markdown("### 📊 最近一次对话的 SOUL 分析")
        soul = st.session_state.soul_analysis
        # 四个阶段的进度条可视化
        stages = [
            ("🔍 情境感知", "S - 情境感知"),
            ("👁️ 专业观察", "O - 专业观察"),
            ("💗 共情理解", "U - 共情理解"),
            ("🌱 学习成长", "L - 学习成长")
        ]
        for emoji, key in stages:
            val = soul.get(key, "")
            status_pct = min(100, max(40, len(val) * 6))
            st.markdown(f"""
            <div style="margin:0.5rem 0;">
                <div style="display:flex;justify-content:space-between;font-size:0.85rem;">
                    <span>{emoji} {key}</span>
                    <span>完成</span>
                </div>
                <div style="background:#eee;border-radius:10px;height:8px;margin-top:4px;">
                    <div style="background:linear-gradient(90deg,#667eea,#764ba2);border-radius:10px;height:8px;width:{status_pct}%;"></div>
                </div>
                <div style="font-size:0.85rem;color:#555;margin-top:4px;">{val}</div>
            </div>
            """, unsafe_allow_html=True)
    else:
        st.info("💡 开始对话后，这里会展示 SOUL 框架对每次交互的深度分析")

# ===== TAB 3: 成长轨迹 =====
with tab3:
    st.markdown("### 📈 心理成长轨迹")

    col1, col2, col3 = st.columns(3)
    with col1:
        st.metric("💬 总对话次数", st.session_state.chat_count)
    with col2:
        st.metric("📚 学习知识点", len(st.session_state.knowledge_points))
    with col3:
        if st.session_state.emotion_log:
            avg = sum(e["score"] for e in st.session_state.emotion_log) / len(st.session_state.emotion_log)
            st.metric("❤️ 平均情绪指数", f"{avg:.1f}/10")
        else:
            st.metric("❤️ 平均情绪指数", "—")

    # 情绪变化曲线
    if len(st.session_state.emotion_log) >= 2:
        df = pd.DataFrame(st.session_state.emotion_log)
        fig = px.line(df, x="time", y="score", markers=True,
                      title="情绪变化曲线",
                      labels={"time": "时间", "score": "情绪评分"},
                      range_y=[0, 10])
        fig.update_traces(line_color="#667eea", line_width=3, marker=dict(size=8, color="#764ba2"))
        fig.update_layout(
            plot_bgcolor="rgba(0,0,0,0)",
            paper_bgcolor="rgba(0,0,0,0)",
            font=dict(family="Noto Sans SC"),
            hovermode="x unified"
        )
        fig.add_hline(y=5, line_dash="dash", line_color="gray", opacity=0.5)
        st.plotly_chart(fig, use_container_width=True)
    elif st.session_state.emotion_log:
        st.info("📊 再聊几次就能看到情绪变化曲线了！")
        # 显示当前情绪点
        df = pd.DataFrame(st.session_state.emotion_log)
        fig = px.bar(df, x="time", y="score", title="当前情绪",
                     color="score", color_continuous_scale=["#ff6b6b","#ffd93d","#6bcb77"],
                     labels={"score": "情绪评分"})
        st.plotly_chart(fig, use_container_width=True)
    else:
        st.info("💬 开始对话后，这里会记录你的情绪变化轨迹")
        # 展示占位图
        placeholder = pd.DataFrame({"time": ["对话1", "对话2", "对话3", "对话4", "对话5"],
                                    "score": [5, 5, 5, 5, 5]})
        fig = px.line(placeholder, x="time", y="score", title="期待你的成长数据 ✨",
                      range_y=[0, 10])
        fig.update_traces(line=dict(color="#ccc", width=2, dash="dot"))
        fig.update_layout(plot_bgcolor="rgba(0,0,0,0)", paper_bgcolor="rgba(0,0,0,0)")
        st.plotly_chart(fig, use_container_width=True)

    # 知识点雷达图
    if st.session_state.knowledge_points:
        st.divider()
        all_topics = list(RESPONSE_TEMPLATES.keys())
        values = [10 if t in st.session_state.knowledge_points else 0 for t in all_topics]
        fig = go.Figure(data=go.Scatterpolar(
            r=values + [values[0]],
            theta=all_topics + [all_topics[0]],
            fill='toself',
            fillcolor='rgba(102, 126, 234, 0.3)',
            line=dict(color='#667eea', width=2)
        ))
        fig.update_layout(
            polar=dict(radialaxis=dict(visible=True, range=[0, 10])),
            title="知识覆盖雷达图",
            showlegend=False,
            font=dict(family="Noto Sans SC"),
            plot_bgcolor="rgba(0,0,0,0)",
            paper_bgcolor="rgba(0,0,0,0)"
        )
        st.plotly_chart(fig, use_container_width=True)
    else:
        st.info("📚 多聊聊心理学话题，填补你的知识地图吧！")

    # 重置按钮
    st.divider()
    if st.button("🔄 重置所有数据", use_container_width=True, type="secondary"):
        for key in ["messages", "emotion_log", "knowledge_points", "soul_analysis", "chat_count"]:
            if key == "messages":
                st.session_state[key] = []
            elif key == "emotion_log":
                st.session_state[key] = []
            elif key == "knowledge_points":
                st.session_state[key] = set()
            elif key == "chat_count":
                st.session_state[key] = 0
            elif key == "soul_analysis":
                st.session_state[key] = ""
        st.rerun()

# ── 页脚 ──
st.divider()
st.markdown("""
<div style="text-align:center;font-size:0.8rem;color:#999;padding:1rem 0;">
    <strong>🧠 MindGuide · 私人心理老师</strong> ｜  综合素质创新项目 ｜
    <span style="color:#e74c3c;">❤️ 本应用为教育演示，不能替代专业心理治疗</span>
</div>
""", unsafe_allow_html=True)
