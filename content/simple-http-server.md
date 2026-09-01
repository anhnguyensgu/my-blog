---
title: Simple HTTP Server in Odin
date: 2026-05-02
tags: odin, http, server
summary: Starting with core:net, accepting a TCP connection, and writing the smallest useful HTTP response by hand.
---

The first useful version of this blog does not need a framework. It needs a TCP listener, one parser boundary, and a response writer that always sends valid HTTP.

## The Shape

The server accepts one connection, reads the browser request into a fixed buffer, picks a page, and writes HTML back with a correct `Content-Length`.

```odin
server, listen_err := net.listen_tcp(endpoint)
client, _, accept_err := net.accept_tcp(server)

n, recv_err := net.recv_tcp(client, request_buf[:])
_, send_err := net.send_tcp(client, transmute([]byte)response)
```

> The blog generator can stay static. The Odin HTTP server is useful as a local preview server while writing posts.

## Next Boundary

After the raw server works, the next step is not routing complexity. The next step is a tiny file contract: generated pages live in `public/`, and the server maps URL paths to those files.
