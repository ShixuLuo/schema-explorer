# CQL local performance patch

Source: [CQL release 20261024, TalgSimplifier.java](https://github.com/CategoricalData/CQL/blob/20261024/src/catdata/cql/fdm/TalgSimplifier.java).
Copyright (c) 2015+ Conexus AI, Inc. All rights reserved.

The upstream README grants the BSD 3 license for non-commercial use and exploratory/evaluative commercial use; contact Conexus for other licenses. That scope is retained here. See [upstream licensing](https://github.com/CategoricalData/CQL/blob/20261024/README.md#license) and `BSD-3-Clause.txt`.

The sole algorithm change is in substitution composition: terms without Skolem variables cannot be affected by substituting a Skolem variable, so only definitions that still contain such variables are revisited. The original substitution operation, term reduction, contradiction detection, and consistency checks remain active. This removes quadratic rescanning of already constant definitions. The worker classes precede the pinned official jar on the classpath; the jar itself remains unchanged.

Upstream source SHA-256: `3ee22183cfd39c5e2e40fbfa91e5c58a44167a3cb12df9bc4aa5b8126933435f`.
