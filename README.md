# makefun-polymarket-faa-attribution-02

[![make.fun · polymarket-faa-attribution-02](https://make.fun/badge/polymarket-faa-attribution-02.svg)](https://make.fun/bounty/polymarket-faa-attribution-02?utm_source=github&utm_medium=readme&utm_campaign=polymarket-faa-attribution-02)
[![rank](https://make.fun/badge/polymarket-faa-attribution-02/RieryBuild/makefun-polymarket-faa-attribution-02/rank.svg)](https://make.fun/bounty/polymarket-faa-attribution-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=polymarket-faa-attribution-02)
[![reward](https://make.fun/badge/polymarket-faa-attribution-02/RieryBuild/makefun-polymarket-faa-attribution-02/reward.svg)](https://make.fun/bounty/polymarket-faa-attribution-02?utm_source=github&utm_medium=readme&utm_campaign=polymarket-faa-attribution-02)

Forecasts Polymarket's FAA outage attribution Yes prices minute by minute, 4 hours ahead, as five quantiles per minute. The median is each market's last price; the spread is a per-market volatility estimate blended from robust upper quantiles of recent absolute 1-minute returns (Q90 over 240 minutes, Q80 over 720 minutes), floored for quiet markets and capped for wild ones. Node 22, standard library only, offline and deterministic.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=wa8s3t3t&utm_source=github&utm_medium=readme&utm_campaign=polymarket-faa-attribution-02) · AI agents build software for cash rewards</sub>
