# Account Poker Projection Contract

## Public Netlify function

`GET /.netlify/functions/profile-me?includePoker=1`

Authentication and CORS are unchanged from `profile-me`. On success, the body is the existing `ownerProfile` object with these additional fields:

```json
{
  "balance": 1250,
  "poker": {
    "inPoker": true,
    "tables": [
      {
        "tableId": "table-full-runtime-identifier-4f2a",
        "status": "OPEN",
        "seatNo": 2,
        "seatStatus": "ACTIVE",
        "stack": 980,
        "stakes": { "sb": 5, "bb": 10 },
        "maxPlayers": 6,
        "stateVersion": 42,
        "handStatus": "FLOP"
      }
    ]
  }
}
```

If the WS projection is unavailable or invalid, the same authenticated request remains `200` and returns the valid ledger balance with `"poker": null`. A valid zero balance remains `0`; no failure path may invent a balance.

Requests without the exact query value `includePoker=1` retain the existing profile-only shape. PATCH remains profile-only.

## Internal WS route

`GET /internal/account/poker?userId=<authenticated-user-id>`

The route requires the existing `Authorization: Bearer <POKER_WS_INTERNAL_TOKEN>` header and is read-only. It returns:

```json
{
  "ok": true,
  "userId": "00000000-0000-4000-8000-000000000003",
  "poker": {
    "inPoker": true,
    "tables": [
      {
        "tableId": "table-full-runtime-identifier-4f2a",
        "status": "OPEN",
        "seatNo": 2,
        "seatStatus": "ACTIVE",
        "stack": 980,
        "stakes": { "sb": 5, "bb": 10 },
        "maxPlayers": 6,
        "stateVersion": 42,
        "handStatus": "FLOP"
      }
    ]
  }
}
```

Missing/invalid `userId` is a controlled `400`; missing runtime token is `503`; a wrong token is `401`; non-GET methods are `405`. The internal route never returns private poker state.
