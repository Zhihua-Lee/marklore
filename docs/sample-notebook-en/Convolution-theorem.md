# Convolution theorem

Convolution turns a sliding weighted sum into a pointwise product in the frequency domain. It underlies filter design and fast convolution algorithms.

## Definition

$$
(f * g)(t) = \int_{-\infty}^{\infty} f(\tau)\, g(t - \tau)\, d\tau .
$$

## Theorem

If $f$ and $g$ are integrable, then

$$
\widehat{f * g}(\omega) = \hat f(\omega)\, \hat g(\omega) .
$$

## Proof sketch

Swap the order of integration and substitute $s = t - \tau$:

$$
\widehat{f * g}(\omega)
= \int f(\tau) e^{-i\omega\tau} \left( \int g(s) e^{-i\omega s} ds \right) d\tau
= \hat f(\omega)\, \hat g(\omega).
$$

The key steps are Fubini's theorem, which allows the swap, and $e^{-i\omega t} = e^{-i\omega\tau} e^{-i\omega s}$, which lets the integrand separate.

## Applications

- **Fast convolution:** two FFTs, one pointwise product and one inverse FFT take the cost from $O(N^2)$ to $O(N \log N)$.
- **Filtering:** an ideal low-pass filter is a rectangle in the frequency domain.
- **Deconvolution:** dividing in the frequency domain approximately recovers the original signal, but amplifies noise.

Back to [Fourier analysis](Fourier-analysis.md#properties).
