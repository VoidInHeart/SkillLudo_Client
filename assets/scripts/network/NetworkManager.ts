import { sys } from 'cc';
import type { ClientMessage, ClientMessageType, ServerMessage, ServerMessageType } from '../protocol/GameProtocol';

type MessageHandler = (message: ServerMessage) => void;

/** The only class in the client that speaks WebSocket directly. */
export class NetworkManager {
  private socket: WebSocket | null = null;
  private readonly handlers = new Map<string, Set<MessageHandler>>();
  private url = '';
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private manuallyDisconnected = false;
  private heartbeatTimer: number | null = null;

  public connect(url: string): Promise<void> {
    this.url = url;
    this.manuallyDisconnected = false;
    return new Promise((resolve, reject) => {
      try {
        this.socket?.close();
        const socket = new WebSocket(url);
        this.socket = socket;
        socket.onopen = () => {
          this.reconnectAttempt = 0;
          this.startHeartbeat();
          this.emit('OPEN', { type: 'PONG', data: {}, serverTime: Date.now() });
          resolve();
        };
        socket.onmessage = (event) => this.handleMessage(event.data);
        socket.onerror = () => {
          if (socket.readyState !== WebSocket.OPEN) reject(new Error('无法连接游戏服务器'));
          this.emit('NETWORK_ERROR', { type: 'ERROR', data: { code: 'NETWORK_ERROR', message: '网络连接异常' }, serverTime: Date.now() });
        };
        socket.onclose = () => {
          this.stopHeartbeat();
          this.emit('CLOSE', { type: 'ERROR', data: { code: 'DISCONNECTED', message: '连接已断开' }, serverTime: Date.now() });
          if (!this.manuallyDisconnected) this.scheduleReconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  public disconnect(): void {
    this.manuallyDisconnected = true;
    this.stopHeartbeat();
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
  }

  public send<T extends Record<string, unknown>>(type: ClientMessageType, data: T): string {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('网络尚未连接');
    const requestId = this.createRequestId();
    const message: ClientMessage<T> = { type, requestId, data };
    this.socket.send(JSON.stringify(message));
    return requestId;
  }

  public on(type: ServerMessageType | 'OPEN' | 'CLOSE' | 'NETWORK_ERROR', handler: MessageHandler): () => void {
    const listeners = this.handlers.get(type) ?? new Set<MessageHandler>();
    listeners.add(handler);
    this.handlers.set(type, listeners);
    return () => listeners.delete(handler);
  }

  private handleMessage(raw: unknown): void {
    try {
      const message = JSON.parse(String(raw)) as ServerMessage;
      if (!message.type || typeof message.type !== 'string') throw new Error('无效服务器消息');
      this.emit(message.type, message);
    } catch (error) {
      this.emit('NETWORK_ERROR', { type: 'ERROR', data: { code: 'INVALID_SERVER_MESSAGE', message: String(error) }, serverTime: Date.now() });
    }
  }

  private emit(type: string, message: ServerMessage): void {
    this.handlers.get(type)?.forEach((handler) => handler(message));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || !this.url) return;
    const delay = Math.min(1_000 * Math.pow(2, this.reconnectAttempt), 10_000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(this.url).catch(() => undefined);
    }, delay) as unknown as number;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        try { this.send('PING', { roomId: sys.localStorage.getItem('skillLudo.roomId') ?? '' }); } catch { /* reconnect loop owns errors */ }
      }
    }, 10_000) as unknown as number;
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private createRequestId(): string {
    return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
