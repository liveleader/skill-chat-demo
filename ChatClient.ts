import WebSocket from "ws";

let LOCAL = process.env.LOCAL;

export interface ChatMessage {
  content: string;
  role: "user" | "assistant";
  requestId?: string;
  sources?: Source[];
}

export interface Options {

  // The skill to query: required
  skillId: string;

  onResponse?: (updatedMessage: ChatMessage, chunk?: Chunk) => void;

  // Use your own prompt/system message
  prompt?: string;

  // Append to the existing skill prompt
  appendPrompt?: boolean;

  // Use partner skill, if available
  partnerId?: string;

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
  options: Options;

  constructor(client: ChatClient, options: Options) {
    this.client = client;
    this.options = options;
  }

  async send(message: string): Promise<ChatMessage> {

    let atLeastOneChunk = false;
    let requestId = Math.random().toString(36).substring(7);
    let onDone = this.client.listen(requestId, (chunk) => {
      for (const message of this.messages) {
        if (message.requestId == requestId) {
          message.content += chunk.delta;
          this.options.onResponse?.(message, chunk);
          atLeastOneChunk = true;
        }
      }
    });

    // Add our new message
    this.messages.push({ content: message, role: "user" });

    let postMessages = [...this.messages];

    // Also add an initial, empty response we can update
    let msg: ChatMessage = { content: "", role: "assistant", requestId };
    this.messages.push(msg);

    let server = `https://api.${this.client.domain}`;
    if (LOCAL) {
      server = "http://localhost:8080";
    }
    let url = server + "/v1/skills/" + this.options.skillId + "/chat";
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
    let finalMessage = data.message as ChatMessage;

    if (!atLeastOneChunk) {
      // Send a chunk with the full message, in those cases where we don't get a chunk
      this.options.onResponse?.(finalMessage, { index: 0, delta: finalMessage.content, requestId });
    }

    // Update the message with the final response
    for (const message of this.messages) {
      if (message.requestId == requestId) {
        Object.assign(message, { ...finalMessage, requestId: undefined });
        this.options.onResponse?.(message);
      }
    }

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

  newChat(options: Options) {
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
  let skillId = process.env.SKILL_ID;

  if (!token || !skillId) {
    console.error("Please set TOKEN and SKILL_ID environment variables");
    process.exit(1);
  }

  let options:Options = {
    skillId: skillId,
    // partnerId: "1234",
    onResponse: output,
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
