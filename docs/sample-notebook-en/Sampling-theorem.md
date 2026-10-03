# Sampling theorem

How fast must a continuous signal be sampled for the samples to determine it completely? The answer depends on its spectrum.

## Theorem

<a id="sampling"></a>

**Theorem (Nyquist–Shannon).** If the [Fourier transform](Fourier-analysis.md#ft-def) of $f$ vanishes for $\lvert\omega\rvert > \Omega$, then samples at spacing $T \le \pi / \Omega$ recover $f$ exactly:

$$
f(t) = \sum_{n=-\infty}^{\infty} f(nT)\, \operatorname{sinc}\!\left(\frac{t - nT}{T}\right).
$$

## Why it holds

Sampling multiplies the signal by a train of impulses. By the [convolution theorem](Convolution-theorem.md#theorem), a product in time is a convolution in frequency, so the spectrum is copied every $2\pi / T$. As long as the copies do not overlap, a low-pass filter gives the original spectrum back.

## Aliasing

When sampling is too slow, the copies overlap and high frequencies masquerade as low ones: that is aliasing. In practice an anti-aliasing filter comes before the sampler.
