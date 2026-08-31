import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCheck, ImagePlus, Loader2, MessageCircle, MoreVertical, Reply, Send, Trash2, Pencil, X } from 'lucide-react';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { getCurrentRealFirebaseUser } from '../../lib/firebase';
import {
  GENERAL_CONVERSATION_ID,
  CHAT_SEND_ERROR_EVENT,
  editOwnMessage,
  loadOlderMessages,
  markConversationRead,
  sendProjectMessage,
  softDeleteMessage,
  subscribeConversationReadState,
  subscribeConversationSummary,
  subscribeLatestMessages,
  findMentionableMembers,
  type SendMessageInput,
} from '../../lib/chatService';
import { isPresenceConfigured, setTyping, startPresence } from '../../lib/presenceService';
import { createEntityId } from '../../utils/idUtils';
import type { ChatAttachment, ProjectChatMessage } from './types';
import { UnreadBadge } from './UnreadBadge';
import { getPhotoDataUrl, getProjectPhotos, isPhotoSharedCloudReady, savePhotoAttachment } from '../../utils/photoStorage';
import { downloadPhotoBlobFromCloud, uploadPhotoToCloud, verifyPhotoBinaryReadyInCloud } from '../../lib/photoCloudSync';
import { ImageViewerModal } from '../../components/ImageViewerModal';

interface ChatTabProps {
  activeProjectId: string;
  projectName: string;
  projects: Array<{ id: string; name: string }>;
  onSwitchProject: (id: string) => Promise<void> | void;
  onOpenNotificationCenter: () => void;
  userRole: 'ADMIN' | 'EDITOR' | 'VIEWER';
}

const ChatImage: React.FC<{ projectId: string; attachment: ChatAttachment; onOpen?: () => void }> = ({ projectId, attachment, onOpen }) => {
  const photoId = attachment.reference?.type === 'photo' ? attachment.reference.entityId : '';
  const [src, setSrc] = useState('');
  const [cloudState, setCloudState] = useState<'loading' | 'pending' | 'ready' | 'error'>('loading');
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    const load = async () => {
      if (!photoId) return;
      setCloudState('loading');
      const meta = (await getProjectPhotos(projectId, true).catch(() => [])).find((item) => item.id === photoId);
      const pending = Boolean(meta && !isPhotoSharedCloudReady(meta));
      const local = await getPhotoDataUrl(photoId, meta?.cloudUrl || meta?.cloudFileId || '', true, projectId).catch(() => '');
      if (local) {
        if (!cancelled) {
          setSrc(local);
          setCloudState(pending ? 'pending' : 'ready');
        }
        return;
      }
      const blob = await downloadPhotoBlobFromCloud(projectId, photoId).catch(() => null);
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) { setSrc(objectUrl); setCloudState('ready'); }
      } else if (!cancelled) {
        setSrc('');
        setCloudState(pending ? 'pending' : 'error');
      }
    };
    void load();
    const onPhotosChanged = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail || {};
      if (detail.projectId && detail.projectId !== projectId) return;
      setReloadTick((tick) => tick + 1);
    };
    window.addEventListener('qlct-photo-attachments-changed', onPhotosChanged);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      window.removeEventListener('qlct-photo-attachments-changed', onPhotosChanged);
    };
  }, [projectId, photoId, reloadTick]);

  if (!photoId) return null;
  if (src) {
    return (
      <button type="button" onClick={onOpen} className="relative mt-2 block max-w-full text-left" title="Mở thư viện ảnh">
        <img src={src} alt={attachment.fileName || 'Ảnh trao đổi'} className="max-h-64 w-auto max-w-full rounded-xl object-contain bg-slate-100" loading="lazy" />
        {cloudState === 'pending' && <span className="absolute bottom-1.5 left-1.5 rounded-lg border border-amber-200 bg-amber-50/95 px-2 py-1 text-[9px] font-extrabold text-amber-800">⏳ chờ Cloud</span>}
        {cloudState === 'ready' && <span className="absolute bottom-1.5 left-1.5 rounded-lg border border-emerald-200 bg-emerald-50/90 px-2 py-1 text-[9px] font-extrabold text-emerald-700">✓ Cloud</span>}
      </button>
    );
  }
  return (
    <div className={`mt-2 rounded-xl border px-3 py-4 text-center text-[10px] ${cloudState === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
      <div className="font-bold">{cloudState === 'error' ? 'Không tải được ảnh từ Cloud/R2' : cloudState === 'pending' ? 'Ảnh đang chờ Cloud/R2' : 'Đang tải ảnh…'}</div>
      {(cloudState === 'error' || cloudState === 'pending') && (
        <button type="button" onClick={() => setReloadTick((tick) => tick + 1)} className="mt-2 rounded-lg bg-white px-2 py-1 font-extrabold shadow-sm">Tải lại</button>
      )}
    </div>
  );
};

const timeLabel = (millis?: number) => {
  if (!millis) return '';
  return new Date(millis).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
};

export const ChatTab: React.FC<ChatTabProps> = ({ activeProjectId, projectName, projects, onSwitchProject, onOpenNotificationCenter, userRole }) => {
  const [view, setView] = useState<'projects' | 'room'>('projects');
  const [messages, setMessages] = useState<ProjectChatMessage[]>([]);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ProjectChatMessage | null>(null);
  const [editing, setEditing] = useState<ProjectChatMessage | null>(null);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sendError, setSendError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [failedSend, setFailedSend] = useState<SendMessageInput | null>(null);
  const [lastReadAt, setLastReadAt] = useState(0);
  const [lastReadMessageCount, setLastReadMessageCount] = useState(0);
  const [lastMessageAt, setLastMessageAt] = useState(0);
  const [messageCount, setMessageCount] = useState(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const typingTimer = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draftClientIdRef = useRef<string>(createEntityId('msg'));
  const [draftAttachments, setDraftAttachments] = useState<ChatAttachment[]>([]);
  const [viewingImageSet, setViewingImageSet] = useState<{ images: string[]; initialIndex: number } | null>(null);
  const [isPreparingAttachment, setIsPreparingAttachment] = useState(false);
  const [mentionOptions, setMentionOptions] = useState<Array<{ uid: string; email: string; name: string; role: string }>>([]);
  const [selectedMentions, setSelectedMentions] = useState<string[]>([]);
  const [visualViewportHeight, setVisualViewportHeight] = useState(() =>
    typeof window !== 'undefined' ? (window.visualViewport?.height || window.innerHeight) : 720
  );
  const user = getCurrentRealFirebaseUser();
  const unread = Math.max(0, messageCount - lastReadMessageCount) || (lastMessageAt > lastReadAt ? 1 : 0);

  useEffect(() => startPresence(), []);

  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => setVisualViewportHeight(viewport?.height || window.innerHeight);
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => {
    if (!activeProjectId) return;
    const unsubSummary = subscribeConversationSummary(activeProjectId, (summary) => { setLastMessageAt(summary?.lastMessageAtMillis || 0); setMessageCount(Number(summary?.messageCount || 0)); });
    const unsubRead = subscribeConversationReadState(activeProjectId, (millis, count) => { setLastReadAt(millis); setLastReadMessageCount(Number(count || 0)); });
    return () => { unsubSummary(); unsubRead(); };
  }, [activeProjectId]);

  useEffect(() => {
    const handleAsyncSendError = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail || {};
      if (String(detail.projectId || '') !== activeProjectId) return;
      setSendError(detail.message || 'Tin nhắn đã xếp hàng nhưng không gửi được.');
      if (detail.input) setFailedSend(detail.input as SendMessageInput);
    };
    window.addEventListener(CHAT_SEND_ERROR_EVENT, handleAsyncSendError as EventListener);
    return () => window.removeEventListener(CHAT_SEND_ERROR_EVENT, handleAsyncSendError as EventListener);
  }, [activeProjectId]);

  useEffect(() => {
    if (view !== 'room' || !activeProjectId) return;
    setMessages([]);
    setCursor(null);
    const unsub = subscribeLatestMessages(activeProjectId, GENERAL_CONVERSATION_ID, (next, nextCursor) => {
      setMessages((prev) => {
        const older = prev.filter((item) => !item.pending && !next.some((n) => n.id === item.id));
        return [...older, ...next].sort((a, b) => (a.createdAtMillis || 0) - (b.createdAtMillis || 0));
      });
      setCursor(nextCursor);
      markConversationRead(activeProjectId).catch(() => {});
      window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
    }, (err) => setSendError(err.message || 'Không thể tải trao đổi.'));
    return () => unsub();
  }, [activeProjectId, view]);

  useEffect(() => () => {
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    setTyping(`${activeProjectId}:${GENERAL_CONVERSATION_ID}`, false).catch(() => {});
  }, [activeProjectId]);

  const handleTextChange = (value: string) => {
    setText(value);
    const atIndex = value.lastIndexOf('@');
    const mentionQuery = atIndex >= 0 ? value.slice(atIndex + 1).trim() : '';
    if (atIndex >= 0 && !value.slice(atIndex + 1).includes('\n') && mentionQuery.length <= 40) {
      findMentionableMembers(activeProjectId, mentionQuery).then((members) => setMentionOptions(members)).catch(() => setMentionOptions([]));
    } else {
      setMentionOptions([]);
    }
    if (!isPresenceConfigured) return;
    const conversationKey = `${activeProjectId}:${GENERAL_CONVERSATION_ID}`;
    setTyping(conversationKey, Boolean(value.trim())).catch(() => {});
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => setTyping(conversationKey, false).catch(() => {}), 2500);
  };

  const chooseMention = (member: { uid: string; name: string }) => {
    const atIndex = text.lastIndexOf('@');
    const prefix = atIndex >= 0 ? text.slice(0, atIndex) : `${text} `;
    setText(`${prefix}@${member.name} `);
    setSelectedMentions((prev) => Array.from(new Set([...prev, member.uid])));
    setMentionOptions([]);
  };

  const handleImageSelected = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setSendError('Chỉ hỗ trợ ảnh JPG/PNG/WebP trong bản chat hiện tại.'); return; }
    setIsPreparingAttachment(true);
    setSendError('');
    try {
      const photo = await savePhotoAttachment({
        projectId: activeProjectId,
        entityType: 'chat',
        entityId: draftClientIdRef.current,
        category: 'chat_attachment',
        fileName: file.name || `chat-${Date.now()}.jpg`,
        mimeType: file.type || 'image/jpeg',
        createdByUid: user?.uid,
      }, file);
      const attachment: ChatAttachment = {
        type: 'image',
        fileName: photo.fileName,
        mimeType: photo.mimeType,
        size: photo.fileSize,
        reference: { type: 'photo', entityId: photo.id, projectId: activeProjectId },
      };
      setDraftAttachments((prev) => [...prev, attachment]);
      // Reuse the existing project photo cloud pipeline; message never stores Base64.
      uploadPhotoToCloud(activeProjectId, photo).catch((err) => console.warn('[Chat image upload]', err));
    } catch (err: any) {
      setSendError(err?.message || 'Không chuẩn bị được ảnh đính kèm.');
    } finally {
      setIsPreparingAttachment(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const ensureDraftAttachmentsCloudReady = async () => {
    const imageAttachments = draftAttachments.filter((attachment) => attachment.type === 'image' && attachment.reference?.type === 'photo');
    if (imageAttachments.length === 0) return;
    const photos = await getProjectPhotos(activeProjectId, true);
    for (const attachment of imageAttachments) {
      const photoId = attachment.reference?.entityId || '';
      if (!photoId) continue;
      if (await verifyPhotoBinaryReadyInCloud(activeProjectId, photoId)) continue;
      const photo = photos.find((item) => item.id === photoId);
      if (!photo) throw new Error(`Ảnh ${photoId} chưa có metadata local để tải lên Cloud.`);
      await uploadPhotoToCloud(activeProjectId, photo);
      const ready = await verifyPhotoBinaryReadyInCloud(activeProjectId, photoId);
      if (!ready) throw new Error(`Ảnh ${photo.fileName || photoId} vẫn chưa xác nhận được trên Cloud/R2.`);
    }
  };

  const openMessageImageGallery = async (message: ProjectChatMessage, clickedIndex: number) => {
    const attachments = (message.attachments || []).filter((attachment) => attachment.type === 'image' && attachment.reference?.type === 'photo');
    if (attachments.length === 0) return;
    const resolved = await Promise.all(attachments.map(async (attachment) => {
      const photoId = attachment.reference?.entityId || '';
      return photoId ? getPhotoDataUrl(photoId, '', false, activeProjectId).catch(() => '') : '';
    }));
    const indexed = resolved.map((url, index) => ({ url, index })).filter((item) => Boolean(item.url));
    if (indexed.length === 0) return;
    const initialIndex = Math.max(0, indexed.findIndex((item) => item.index === clickedIndex));
    setViewingImageSet({ images: indexed.map((item) => item.url), initialIndex });
  };

  const handleSend = async () => {
    if (isSending || isPreparingAttachment) return;
    const clean = text.trim();
    if (!clean && draftAttachments.length === 0) return;
    if (!activeProjectId) { setSendError('Chưa chọn dự án để gửi tin nhắn.'); return; }
    setSendError('');
    setIsSending(true);
    try {
      if (!editing && draftAttachments.some((attachment) => attachment.type === 'image')) {
        setSendError('Đang xác nhận ảnh trên Cloud/R2 trước khi gửi…');
        await ensureDraftAttachmentsCloudReady();
        setSendError('');
      }
      if (editing) {
        await editOwnMessage(activeProjectId, editing.id, clean);
        setEditing(null);
      } else {
        const payload: SendMessageInput = {
          projectId: activeProjectId,
          text: clean,
          clientMessageId: draftClientIdRef.current,
          attachments: draftAttachments,
          mentions: selectedMentions,
          replyTo: replyTo ? {
            messageId: replyTo.id,
            senderName: replyTo.senderName,
            textPreview: replyTo.text.slice(0, 120),
          } : null,
        };
        await sendProjectMessage(payload);
        setFailedSend(null);
      }
      // The message is either acknowledged or safely held in the dedicated outbox.
      // A permanent Firebase rejection is surfaced by CHAT_SEND_ERROR_EVENT with a retry action.
      setText('');
      setReplyTo(null);
      setDraftAttachments([]);
      setSelectedMentions([]);
      draftClientIdRef.current = createEntityId('msg');
      setTyping(`${activeProjectId}:${GENERAL_CONVERSATION_ID}`, false).catch(() => {});
    } catch (err: any) {
      setSendError(err?.message || 'Không gửi được tin nhắn.');
      if (!editing) {
        setFailedSend({
          projectId: activeProjectId,
          text: clean,
          clientMessageId: draftClientIdRef.current,
          attachments: draftAttachments,
          mentions: selectedMentions,
          replyTo: replyTo ? { messageId: replyTo.id, senderName: replyTo.senderName, textPreview: replyTo.text.slice(0, 120) } : null,
        });
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleRetrySend = async () => {
    if (!failedSend || isSending) return;
    setIsSending(true);
    setSendError('');
    try {
      await sendProjectMessage(failedSend);
      setFailedSend(null);
    } catch (err: any) {
      setSendError(err?.message || 'Gửi lại chưa thành công.');
    } finally {
      setIsSending(false);
    }
  };

  const handleLoadOlder = async () => {
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const result = await loadOlderMessages(activeProjectId, GENERAL_CONVERSATION_ID, cursor);
      setMessages((prev) => {
        const map = new Map([...result.messages, ...prev].map((m) => [m.id, m]));
        return Array.from(map.values()).sort((a, b) => (a.createdAtMillis || 0) - (b.createdAtMillis || 0));
      });
      setCursor(result.cursor);
    } finally {
      setLoadingOlder(false);
    }
  };

  const visibleProjects = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    projects.forEach((p) => p?.id && map.set(p.id, p));
    if (!map.has(activeProjectId)) map.set(activeProjectId, { id: activeProjectId, name: projectName });
    return Array.from(map.values());
  }, [projects, activeProjectId, projectName]);

  if (view === 'projects') {
    return (
      <div className="max-w-3xl mx-auto p-3 sm:p-5 pb-24 space-y-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2"><MessageCircle className="w-5 h-5 text-indigo-600" /> Trao đổi</h2>
              <p className="text-xs text-slate-500 mt-1">Chat được tách theo từng projectId, không dùng phòng chung cho toàn bộ tài khoản Firebase.</p>
            </div>
            <button onClick={onOpenNotificationCenter} className="px-3 py-2 rounded-xl bg-slate-100 text-xs font-bold text-slate-700">Thông báo</button>
          </div>
        </div>

        <div className="space-y-2">
          {visibleProjects.map((project) => {
            const isActive = project.id === activeProjectId;
            return (
              <button
                key={project.id}
                onClick={async () => {
                  if (!isActive) await onSwitchProject(project.id);
                  setView('room');
                }}
                className="w-full bg-white border border-slate-200 rounded-2xl p-4 text-left shadow-sm hover:border-indigo-300 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-extrabold text-sm text-slate-900 truncate">{project.name || project.id}</div>
                  <div className="text-[11px] text-slate-500 mt-1">{isActive && unread ? 'Có tin chưa đọc' : 'Mở phòng trao đổi dự án'}</div>
                </div>
                {isActive && <UnreadBadge count={unread} />}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      className="max-w-3xl mx-auto flex flex-col bg-white sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-sm overflow-hidden"
      style={{ height: `${Math.max(320, visualViewportHeight - 112)}px` }}
    >
      <div className="shrink-0 px-3 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2 bg-white">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => setView('projects')} className="w-9 h-9 rounded-xl hover:bg-slate-100 flex items-center justify-center"><ArrowLeft className="w-5 h-5" /></button>
          <div className="min-w-0">
            <div className="text-sm font-extrabold text-slate-900 truncate">{projectName}</div>
            <div className="text-[10px] text-slate-500">Phòng dự án · {isPresenceConfigured ? 'Trạng thái online hoạt động' : 'Tin nhắn realtime'}</div>
          </div>
        </div>
        <MoreVertical className="w-5 h-5 text-slate-500" />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-slate-50">
        {cursor && messages.length >= 50 && (
          <div className="text-center">
            <button onClick={handleLoadOlder} disabled={loadingOlder} className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700">
              {loadingOlder ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Tải tin cũ hơn'}
            </button>
          </div>
        )}
        {messages.length === 0 && <div className="text-center text-xs text-slate-400 py-10">Chưa có tin nhắn. Hãy bắt đầu trao đổi cho dự án này.</div>}
        {messages.map((message) => {
          const mine = message.senderUid === user?.uid;
          const deleted = Boolean(message.deletedAt);
          return (
            <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[86%] sm:max-w-[74%] rounded-2xl px-3 py-2 shadow-sm ${mine ? 'bg-indigo-600 text-white rounded-br-md' : 'bg-white text-slate-900 border border-slate-200 rounded-bl-md'}`}>
                {!mine && <div className="text-[10px] font-extrabold text-indigo-600 mb-1">{message.senderName}</div>}
                {message.replyTo && !deleted && (
                  <div className={`mb-1.5 pl-2 border-l-2 text-[10px] ${mine ? 'border-indigo-300 text-indigo-100' : 'border-slate-300 text-slate-500'}`}>
                    <div className="font-bold">{message.replyTo.senderName}</div>
                    <div className="truncate">{message.replyTo.textPreview}</div>
                  </div>
                )}
                <div className={`text-sm whitespace-pre-wrap break-words ${deleted ? 'italic opacity-70' : ''}`}>{deleted ? 'Tin nhắn đã được xóa' : message.text}</div>
                {!deleted && message.attachments?.filter((a) => a.type === 'image').map((attachment, index) => (
                  <ChatImage
                    key={`${attachment.reference?.entityId || index}`}
                    projectId={activeProjectId}
                    attachment={attachment}
                    onOpen={() => void openMessageImageGallery(message, index)}
                  />
                ))}
                <div className={`mt-1 flex items-center gap-1.5 text-[9px] ${mine ? 'text-indigo-100 justify-end' : 'text-slate-400'}`}>
                  <span>{timeLabel(message.createdAtMillis)}</span>
                  {message.editedAt && !deleted && <span>đã chỉnh sửa</span>}
                  {mine && message.pending && <span>Đang gửi…</span>}
                  {mine && !message.pending && <CheckCheck className="w-3 h-3" />}
                </div>
                {!deleted && (
                  <div className={`mt-1.5 flex gap-2 text-[10px] ${mine ? 'justify-end text-indigo-100' : 'text-slate-500'}`}>
                    <button onClick={() => setReplyTo(message)} className="inline-flex items-center gap-1"><Reply className="w-3 h-3" /> Reply</button>
                    {mine && <button onClick={() => { setEditing(message); setText(message.text); }} className="inline-flex items-center gap-1"><Pencil className="w-3 h-3" /> Sửa</button>}
                    {mine && <button onClick={() => softDeleteMessage(activeProjectId, message.id).catch((err) => setSendError(err.message))} className="inline-flex items-center gap-1"><Trash2 className="w-3 h-3" /> Xóa</button>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {(replyTo || editing) && (
        <div className="shrink-0 px-3 py-2 border-t border-slate-200 bg-slate-50 text-[11px] flex items-center justify-between gap-2">
          <div className="truncate"><strong>{editing ? 'Đang sửa:' : `Trả lời ${replyTo?.senderName}:`}</strong> {editing ? editing.text : replyTo?.text}</div>
          <button onClick={() => { setReplyTo(null); setEditing(null); if (editing) setText(''); }} className="font-bold text-rose-600">Hủy</button>
        </div>
      )}
      {draftAttachments.length > 0 && (
        <div className="shrink-0 px-3 py-2 border-t border-slate-200 bg-slate-50 flex gap-2 overflow-x-auto">
          {draftAttachments.map((attachment, index) => (
            <div key={`${attachment.reference?.entityId || index}`} className="relative shrink-0 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-[10px] text-slate-600 max-w-40 truncate">
              {attachment.fileName || 'Ảnh'} <span className="text-amber-700 font-bold">· chờ Cloud</span>
              <button onClick={() => setDraftAttachments((prev) => prev.filter((_, i) => i !== index))} className="ml-2 text-rose-600"><X className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      )}
      {sendError && (
        <div className="shrink-0 px-3 py-2 bg-rose-50 text-rose-700 text-[11px] border-t border-rose-100 flex items-center justify-between gap-2">
          <span className="min-w-0">{sendError}</span>
          {failedSend && (
            <button type="button" onClick={handleRetrySend} disabled={isSending} className="shrink-0 px-2.5 py-1 rounded-lg bg-rose-600 text-white font-bold disabled:opacity-50">
              {isSending ? 'Đang gửi…' : 'Gửi lại'}
            </button>
          )}
        </div>
      )}
      <div className="shrink-0 p-2.5 border-t border-slate-200 bg-white flex items-end gap-2">
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => handleImageSelected(e.target.files?.[0])} />
        <div className="relative flex-1 flex items-end gap-2">
          {mentionOptions.length > 0 && (
            <div className="absolute bottom-12 left-0 right-0 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl z-20 p-1">
              {userRole === 'ADMIN' && <button type="button" onClick={() => { setText((v) => `${v.slice(0, Math.max(0, v.lastIndexOf('@')))}@mọi người `); setSelectedMentions((prev) => Array.from(new Set([...prev, 'everyone']))); setMentionOptions([]); }} className="w-full text-left px-3 py-2 rounded-lg text-xs font-bold hover:bg-slate-50">@mọi người <span className="text-[10px] text-slate-400">Admin</span></button>}
              {mentionOptions.map((member) => <button key={member.uid || member.email} type="button" onClick={() => chooseMention(member)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50"><div className="text-xs font-bold text-slate-800">@{member.name}</div><div className="text-[10px] text-slate-400">{member.email} · {member.role}</div></button>)}
            </div>
          )}
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isPreparingAttachment} className="w-10 h-10 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center disabled:opacity-50" aria-label="Đính kèm ảnh">
          {isPreparingAttachment ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
        </button>
        <textarea
          rows={1}
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!isSending && !isPreparingAttachment) handleSend(); } }}
          placeholder="Nhập tin nhắn…"
          className="flex-1 max-h-28 resize-none rounded-2xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button onClick={handleSend} disabled={isSending || isPreparingAttachment || (!text.trim() && draftAttachments.length === 0)} className="w-10 h-10 rounded-full bg-indigo-600 disabled:bg-slate-300 text-white flex items-center justify-center shadow-sm" aria-label={isSending ? 'Đang gửi tin nhắn' : 'Gửi tin nhắn'}>
          {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
        </div>
      </div>
      <ImageViewerModal
        isOpen={Boolean(viewingImageSet)}
        onClose={() => setViewingImageSet(null)}
        images={viewingImageSet?.images || []}
        initialIndex={viewingImageSet?.initialIndex || 0}
      />
    </div>
  );
};
