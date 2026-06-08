# MAS安全研究：跨智能体污染与信任传递攻防

## 研究目标
研究多智能体系统（MAS）中的安全威胁，包括：
- BadChain 后门攻击在多智能体环境中的传播
- Prompt Infection 在智能体间的自我复制与污染
- 攻击者通过控制智能体输入攻陷主机系统的路径

## 环境架构
- **虚拟化**: VirtualBox 7.2.8（沙箱隔离）
- **MAS框架**: AutoGen（微软）
- **LLM后端**: Ollama + Llama 3（本地部署）
- **日志采集**: 结构化 JSON 日志

## 项目结构
```
mas-security-research/
├── src/
│   ├── attacks/          # 攻击场景复现代码
│   │   ├── scene1_injection.py    # 恶意输入注入
│   │   ├── scene2_prompt_infection.py  # Prompt Infection 传播
│   │   └── scene3_badchain.py     # BadChain 后门
│   ├── framework/        # AutoGen 智能体定义与配置
│   ├── logging/          # 日志采集与分析
│   └── utils/            # 工具函数
├── configs/              # 实验配置文件
├── data/                 # 实验数据
│   ├── normal/           # 正常交互日志
│   ├── attacks/          # 攻击状态日志
│   └── compatibility/    # 兼容性问题记录
├── logs/                 # 运行时日志
├── docs/                 # 文档与论文素材
└── scripts/              # 环境搭建脚本
```

## 实验场景
1. **恶意输入注入** → 控制智能体工具调用 → 攻陷主机系统
2. **Prompt Infection 传播** → 恶意提示在智能体间自我复制
3. **BadChain 后门** → 触发词激活恶意行为

## 论文目标
中文核心期刊（预留升级到英文会议的空间）
