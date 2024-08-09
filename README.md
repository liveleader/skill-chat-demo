# Getting started

1. Create an API token in LiveLeader
2. Find the ID of a skill you'd like to test
3. Set environment variables below
4. Run the script
5. Chat with the assistant

# Running the demo

```shell
export DOMAIN=visma.chat
export TOKEN=MY-TOKEN
export SKILL_ID=MY-SKILL-ID

npm install
npm run start
```

# Basic example

```typescript
let client = new ChatClient(domain, token);
await client.connect();

let chat = client.newChat(options);

let completedMessage = await chat.send(
  "I have some questions...", 
  (message: ChatMessage, chunk?: Chunk) => {
    // Handle chunks as needed
    // If you don't want to support streaming, you can just use the completedMessage
  }
);
```

# Architecture

The client uses websockets to retrieve response chunks. A single websocket connection is used
for all chat sessions, separated by request IDs.