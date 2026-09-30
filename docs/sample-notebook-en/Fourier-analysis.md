# Fourier analysis

Splitting a signal into sinusoids of different frequencies is the common starting point of signal processing, partial differential equations and image compression. This note collects the definition of the continuous Fourier transform, its most useful properties and a discrete implementation.

## Definition

For an integrable function $f(t)$, the Fourier transform and its inverse are

$$
\hat f(\omega) = \int_{-\infty}^{\infty} f(t)\, e^{-i\omega t}\, dt,
\qquad
f(t) = \frac{1}{2\pi} \int_{-\infty}^{\infty} \hat f(\omega)\, e^{i\omega t}\, d\omega .
$$

Intuitively, $\hat f(\omega)$ measures how much $f$ resembles the complex exponential $e^{i\omega t}$ of frequency $\omega$.

## Properties

| Property    | Time domain  | Frequency domain                              |
| ----------- | ------------ | --------------------------------------------- |
| Linearity   | $a f + b g$  | $a \hat f + b \hat g$                         |
| Shift       | $f(t - t_0)$ | $e^{-i\omega t_0} \hat f(\omega)$             |
| Scaling     | $f(a t)$     | $\frac{1}{\lvert a\rvert} \hat f(\omega / a)$ |
| Derivative  | $f'(t)$      | $i\omega\, \hat f(\omega)$                    |
| Convolution | $(f * g)(t)$ | $\hat f(\omega)\, \hat g(\omega)$             |

Convolution is the one used most; see the [convolution theorem](Convolution-theorem.md#proof-sketch).

## Parseval's identity

Energy is the same in both domains:

$$
\int_{-\infty}^{\infty} \lvert f(t) \rvert^2 dt = \frac{1}{2\pi} \int_{-\infty}^{\infty} \lvert \hat f(\omega) \rvert^2 d\omega .
$$

> **Tip:** in numerical work, this identity is a quick check that an FFT is normalized correctly.

## Discrete implementation

The discrete Fourier transform of a sequence $x_n$ of length $N$ is $X_k = \sum_{n=0}^{N-1} x_n e^{-2\pi i k n / N}$. Computing it directly takes $O(N^2)$ operations; the fast Fourier transform (FFT) brings that down to $O(N \log N)$.

```python
import numpy as np

def dft(x):
    n = np.arange(len(x))
    k = n.reshape(-1, 1)
    return np.exp(-2j * np.pi * k * n / len(x)) @ x

signal = np.sin(2 * np.pi * 5 * np.linspace(0, 1, 256))
assert np.allclose(dft(signal), np.fft.fft(signal))
```

## Processing pipeline

```mermaid
flowchart LR
  A[Sampled signal] --> B[Window]
  B --> C[FFT]
  C --> D[Spectrum analysis]
  D --> E[Filter]
  E --> F[Inverse FFT]
```

## Window functions

Truncating to a finite length leaks energy across the spectrum. Common windows trade off like this:

| Window      | Main lobe | Side lobes | Use for                          |
| ----------- | --------- | ---------- | -------------------------------- |
| Rectangular | Narrowest | Worst      | Transients, whole-period signals |
| Hann        | Medium    | Good       | General spectrum analysis        |
| Blackman    | Wider     | Very good  | Suppressing strong interferers   |

## To do

- [x] Write down the continuous transform
- [x] Add the table of properties
- [ ] Derive Parseval's identity
- [ ] Compare spectral leakage of the windows

## References

1. E. M. Stein, R. Shakarchi. _Fourier Analysis: An Introduction_.
2. A. V. Oppenheim, R. W. Schafer. _Discrete-Time Signal Processing_.
