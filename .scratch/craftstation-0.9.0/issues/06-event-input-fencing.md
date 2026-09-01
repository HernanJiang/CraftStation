# v0.9/T06 — Fence Events and Inputs Across Active Paths

## Goal

用 Segment/runtime Session/binding epoch 隔离迟到事件与过期控制输入。

## Scope

- Optional canonical event execution envelope。
- Dispatcher、Prompt、steer、permission/question answer、interrupt/terminate guards。
- Stale-event archive policy，以及 Renderer/remote sync/restart replay compatibility。

## Depends On

T03。

## Acceptance

- [ ] 旧事件仍可解码和归档。
- [ ] 旧 epoch 不更新 active message/request/permission/attention/usage/completion state。
- [ ] stale active commands 被稳定拒绝。
- [ ] remote sync 与 restart 保留 Segment provenance。
- [ ] 不做一次性全仓 required-field breaking migration。

## Evidence

Late stream/request/completion、remote/replay 与 backward-compatibility tests。
