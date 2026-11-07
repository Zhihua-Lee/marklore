---
title: 合成笔记
tags: [测试]
---

# 卷积与傅里叶变换

卷积定理说的是 $\mathcal{F}(f * g) = \mathcal{F}(f)\cdot\mathcal{F}(g)$，频域里卷积变成乘法。
这一行是同一段的第二行，带一个脚注[^1]和 \(x+y\) 写法的公式。

$$
\int_{-\infty}^{\infty} f(\tau) g(t-\tau)\,d\tau
$$

\[
a^2 + b^2 = c^2
\]

\begin{align}
a &= b + c \\
d &= e
\end{align}

## 推导步骤

1. 写出定义 $h(t) = (f*g)(t)$
2. 对两边做变换，交换积分次序 $\int\int \to \int\int$
   1. 内层积分是 $g$ 的平移
   2. 平移对应相位 $e^{-i\omega\tau}$
3. 整理得到乘积

3) 括号编号的列表
4) 第二项

- [ ] 待办：检查 $\hat f$ 的定义
- [x] 已完成：画图
* 星号列表项
* 第二项 __下划线加粗__ 和 _下划线斜体_ 以及 ~~删除线~~

要点：

- **线性**：$a f + b g$ 的变换是 $a\hat f + b\hat g$
- *平移*对应相位因子，见上面第 2 步
- 中文和 `inline code` 混排，[一个链接](https://example.com "标题") 和 <https://example.org>，裸地址 https://example.net
- 参考式链接 [文档][doc] 与图片 ![示意图](images/plot.png)

> 引用里也有公式 $x^2 + y^2 = 1$。
> 第二行 <mark style="background-color: #f2d878">高亮</mark> 结束。

| 运算 | 时域    | 频域              |
| :--- | :-----: | ----------------: |
| 卷积 | $f*g$   | $\hat f \hat g$   |
| 管道 | $|x|$   | `a|b`             |

```python
import numpy as np
np.convolve([1, 2], [3, 4])
```

~~~
tilde fence
~~~

    indented code block

```mermaid
flowchart LR
  A --> B
```

<details>
<summary>展开</summary>

里面的段落。

</details>

Setext 标题
===========

***

转义字符 \*不是强调\* 和 1\. 不是列表，价格 \$5。

[^1]: 脚注内容，带 $x$。

[doc]: https://example.com/doc "文档"
