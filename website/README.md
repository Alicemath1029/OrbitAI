[English](README.md) | [简体中文](README.zh-CN.md)

# Orbit

This documentation site belongs to Orbit, a platform developed based on the open-source [Crater](https://github.com/raids-lab/crater) project from RAIDS Lab. The docs have been adapted to describe the Orbit-branded platform and deployment workflow.

This is a Next.js application generated with
[Create Fumadocs](https://github.com/fuma-nama/fumadocs).

## Getting Started

Run development server:

```bash
pnpm config set registry https://registry.npmmirror.com
pnpm install
pnpm dev
```

Open http://localhost:3000/orbit/zh with your browser to see the result.

## Build and serve locally

```bash
pnpm build
pnpm dlx serve@latest out --serve-path /orbit
```

Open http://localhost:3000/orbit/zh with your browser to see the result.

## Before commit

```bash
./hack/squoosh_images.py
```

## Learn More

To learn more about Next.js and Fumadocs, take a look at the following
resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js
  features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [Fumadocs](https://fumadocs.vercel.app) - learn about Fumadocs
