import WebSocket from "ws";

let LOCAL = process.env.LOCAL;

export interface ChatMessage {
  content: string;
  role: "user" | "assistant";
  sources?: Source[];
}

export interface ChatOptions {

  // The skill to query, if any
  skillId?: string;

  // Callback on each response chunk
  onResponse?: (updatedMessage: ChatMessage, chunk?: Chunk) => void;

  // Use your own prompt/system message
  prompt?: string;

  model?: string;

  outputTokens?: number;

}

// The sources used on a chat message
export interface Source {

  title: string;

  url?: string;

  // Always pass this back
  data: string;

}

// Partial message passed back
export interface Chunk {
  index: number;
  delta: string;
  requestId: string;
}

export class Chat {

  client: ChatClient;
  messages: ChatMessage[] = [];
  options: ChatOptions;

  constructor(client: ChatClient, options: ChatOptions) {
    this.client = client;
    this.options = options;
  }

  async send(message: string): Promise<ChatMessage> {

    let requestId = Math.random().toString(36).substring(7);
    // An empty response we can update
    let responseMsg: ChatMessage = { content: "", role: "assistant" };

    let onDone = this.client.listen(requestId, (chunk) => {
      responseMsg.content += chunk.delta;
      this.options.onResponse?.(responseMsg, chunk);
    });

    // Add our new message
    this.messages.push({ content: message, role: "user" });

    let postMessages = [...this.messages];

    this.messages.push(responseMsg);

    let server = `https://api.${this.client.domain}`;
    if (LOCAL) {
      server = "http://localhost:8080";
    }
    let url: string;
    if (this.options.skillId) {
      url = server + "/v1/skills/" + this.options.skillId + "/chat";
    } else {
      url = server + "/v1/ai/chat";
    }
    let response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + this.client.token
      },
      body: JSON.stringify({
        ...this.options,
        requestId,
        sessionId: this.client.sessionId,
        messages: postMessages
      })

    });
    onDone();
    let data: any = await response.json();
    if (!data.message) {
      throw new Error("Error: " + data);
    }
    let finalMessage = data.message as ChatMessage;

    if (!responseMsg.content) {
      // We haven't received any chunks, so send the final message as single chunk
      this.options.onResponse?.(finalMessage, { index: 0, delta: finalMessage.content, requestId });
    }

    // Update the message with the final response
    Object.assign(responseMsg, { ...finalMessage, requestId: undefined });

    this.options.onResponse?.(responseMsg); // No chunk here

    return finalMessage;
  }

}

export class ChatClient {

  private ws: WebSocket | undefined;

  listeners = new Map<string, (chunk: Chunk) => void>();

  token: string;
  domain: string;
  sessionId: string | undefined;

  constructor(domain: string, token: string) {
    this.domain = domain;
    this.token = token;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      let server = `wss://ws.${this.domain}`;
      if (LOCAL) {
        server = "ws://localhost:8081";
      }
      let url = `${server}/?stream=1&token=${encodeURIComponent(this.token)}`;
      console.log(`Connecting to ${server}...`);
      this.ws = new WebSocket(url);

      this.ws.onmessage = (event: any) => {
        const data = JSON.parse(event.data);
        if (data.sessionId) {
          this.sessionId = data.sessionId;
          resolve(true);
        } else {
          let chunk = data as Chunk;
          let requestId = chunk.requestId;
          let listener = this.listeners.get(requestId);
          if (listener) {
            listener(chunk);
          }
        }
      };

      this.ws.onerror = (error: any) => {
        console.error("WebSocket error:", error);
        reject(error);
      };
    });
  }

  listen(requestId: string, listener: (chunk: Chunk) => void) {
    this.listeners.set(requestId, listener);
    return () => {
      this.listeners.delete(requestId);
    };
  }

  newChat(options: ChatOptions) {
    return new Chat(this, options);
  }

}

function output(message: ChatMessage, chunk?: Chunk) {
  if (chunk) {
    process.stdout.write(chunk.delta);
  }

  // Sources available at the end
  if (message.sources?.length) {
    console.log("\n---");
    message.sources?.forEach((source) => {
      console.log("Source:", source.title, source.url);
    });
  }

  if (!chunk) {
    // Final message
    process.stdout.write("\n\n> ");
  }
}

async function demo() {

  let token = process.env.TOKEN;
  let domain = process.env.DOMAIN || "visma.chat"; // LiveLeader service domain
  let skillId = process.env.SKILL_ID; // Optional

  if (!token) {
    console.error("Please set TOKEN environment variable");
    process.exit(1);
  }

  let options:ChatOptions = {
    skillId: skillId,
    // partnerId: "1234",
    onResponse: output,
    model: "CLAUDE3_5_SONNET",
    outputTokens: 100  // Keep this within the model's limits
  };

  let client = new ChatClient(domain, token);
  await client.connect();

  let chat = client.newChat(options);

  // Read from stdin
  process.stdin.setEncoding("utf-8");
  process.stdout.write("Chat with the assistant. Type 'exit' to quit.\n\n> ");
  process.stdin.on("data", async (data) => {
    let message = data.toString().trim();
    if (message == "exit") {
      process.exit(0);
    }
    console.log("");
    await chat.send(message);
  });
}

demo();
