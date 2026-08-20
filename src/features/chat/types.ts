export type ChatAttachmentType = 'image' | 'file' | 'reference';
export type ChatReferenceType = 'defect' | 'room' | 'workItem' | 'checklist' | 'inventory' | 'crewLog' | 'photo';

export interface ChatReference {
  type: ChatReferenceType;
  entityId: string;
  projectId: string;
  floorId?: string;
  roomId?: string;
  label?: string;
}

export interface ChatAttachment {
  type: ChatAttachmentType;
  url?: string;
  thumbnailUrl?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  reference?: ChatReference;
}

export interface ChatReplyTo {
  messageId: string;
  senderName?: string;
  textPreview?: string;
}

export interface ProjectChatMessage {
  id: string;
  conversationId: string;
  projectId: string;
  senderUid: string;
  senderEmail: string;
  senderName: string;
  text: string;
  createdAt: any;
  createdAtMillis?: number;
  clientMessageId: string;
  replyTo?: ChatReplyTo | null;
  mentions?: string[];
  attachments?: ChatAttachment[];
  editedAt?: any;
  deletedAt?: any;
  deletedBy?: string;
  pending?: boolean;
  failed?: boolean;
}

export interface ConversationReadState {
  uid: string;
  lastReadAt?: any;
  lastReadAtMillis?: number;
}

export interface ProjectConversationSummary {
  projectId: string;
  conversationId: string;
  lastMessageAt?: any;
  lastMessageAtMillis?: number;
  lastMessageText?: string;
  lastSenderUid?: string;
  messageCount?: number;
  lastMentions?: string[];
  lastSenderName?: string;
}
