# WXF 2018 reference positions

The JSON records factual chess positions, legal coordinate sequences and rulings, independently organized against the 110 numbered diagrams in the official 2018 World Xiangqi Rules. It does not contain a third-party adjudication implementation or copied test program. Each fixture links its official page; research cross-references identify corresponding coordinate facts in Daniel Tan's reference suite where applicable. That repository has no declared code license and no part of its program is vendored here.

The official eight-ply sequences in diagrams 76, 77, 80 and 105 and the sequences for 107–110 were checked against the manual rather than assuming the research suite's ordering or shortest repeated suffix covered the published example. The tests exercise the rules verdict separately from the warning/forfeit lifecycle.

Primary references:

- [Official English WXF 2018 manual](https://www.wxf-xiangqi.org/images/wxf-rules/2018_World_XiangQi_Rules_English2018.pdf)
- [Official Chinese WXF 2018 manual](https://www.wxf-xiangqi.org/images/wxf-rules/2018_World_Xiangqi_Rules_Chinese_2018.pdf)
- [Tan and Medina, Complete Implementation of WXF Chinese Chess Rules](https://arxiv.org/abs/2412.17334), CC BY 4.0. The site's algorithm is an independent implementation with additional official-example checks.
