import React, { useState, useEffect, useRef } from 'react';
import {
  Shield,
  Lock,
  Unlock,
  Key,
  Users,
  FileText,
  Clock,
  CheckCircle,
  AlertTriangle,
  Trash2,
  Download,
  Eye,
  EyeOff,
  UserCheck,
  RefreshCw,
  X,
  User as UserIcon,
  Crown,
  HardDrive
} from 'lucide-react';
import {
  getStoredPinLockConfig,
  savePinLockConfig,
  getCurrentUserRole,
  setCurrentUserRole,
  getAuditLogs,
  clearAuditLogs,
  logAuditAction,
  getProjectMembers,
  saveProjectMembers,
  addProjectMember,
  removeProjectMember,
  ProjectMember,
  UserRole,
  AuditLogEntry
} from '../utils/securityUtils';
import { hashPin, verifyPin } from '../utils/cryptoUtils';
import { signInWithGoogle, getCurrentFirebaseUser, fetchProjectUserRoleFromCloud, claimProjectOwnership, fetchProjectMembersFromCloud, fetchProjectAuditLogsFromCloud, subscribeProjectMembersRealtime, subscribeProjectAuditLogsRealtime } from '../lib/firebase';
import { saveTextFile } from '../utils/fileExport';

interface SecurityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLockNow: () => void;
  activeProjectId?: string;
  projects?: { id: string; name: string }[];
}

export const SecurityModal: React.FC<SecurityModalProps> = ({
  isOpen,
  onClose,
  onLockNow,
  activeProjectId = 'default',
  projects = []
}) => {
  const [activeTab, setActiveTab] = useState<'pin' | 'rbac' | 'audit'>('pin');

  // PIN state
  const [pinConfig, setPinConfig] = useState(getStoredPinLockConfig());
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [currentPinInput, setCurrentPinInput] = useState('');
  const [pinMsg, setPinMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showPinInput, setShowPinInput] = useState(false);

  // RBAC & Cloud Auth state
  const [currentRole, setRoleState] = useState<UserRole>(getCurrentUserRole());
  const [cloudUser, setCloudUser] = useState<any>(getCurrentFirebaseUser());
  const [cloudRoleInfo, setCloudRoleInfo] = useState<{ allowed: boolean; role: UserRole; isCloudSynced: boolean; ownerUid?: string; ownerEmail?: string; isOwner?: boolean } | null>(null);
  const [isCheckingCloud, setIsCheckingCloud] = useState<boolean>(false);
  const [isClaiming, setIsClaiming] = useState<boolean>(false);
  const [claimMsg, setClaimMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [adminPinPrompt, setAdminPinPrompt] = useState<boolean>(false);
  const [adminPinInput, setAdminPinInput] = useState<string>('');
  const [adminPinError, setAdminPinError] = useState<string>('');

  // Project Members state
  const [selectedPid, setSelectedPid] = useState<string>(activeProjectId);
  const [projectMembers, setProjectMembers] = useState<any[]>([]);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<UserRole>('ENGINEER');
  const [isSavingMember, setIsSavingMember] = useState(false);
  const [memberMsg, setMemberMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const selectedPidRef = useRef(selectedPid);
  const cloudStatusRequestRef = useRef(0);

  // Audit state
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  useEffect(() => {
    selectedPidRef.current = selectedPid;
  }, [selectedPid]);

  const refreshCloudStatus = async (pid: string) => {
    const requestId = ++cloudStatusRequestRef.current;
    setIsCheckingCloud(true);
    try {
      const u = getCurrentFirebaseUser();
      if (requestId === cloudStatusRequestRef.current && selectedPidRef.current === pid) {
        setCloudUser(u);
      }
      if (u && pid) {
        const info = await fetchProjectUserRoleFromCloud(pid, u);
        if (requestId !== cloudStatusRequestRef.current || selectedPidRef.current !== pid) {
          return;
        }
        setCloudRoleInfo(info);
        if (info.allowed && info.role) {
          setRoleState(info.role);
          setCurrentUserRole(info.role);
        }
      } else {
        if (requestId === cloudStatusRequestRef.current && selectedPidRef.current === pid) {
          setCloudRoleInfo(null);
        }
      }
    } catch (e) {
      console.warn('Error refreshing cloud status in SecurityModal:', e);
    } finally {
      if (requestId === cloudStatusRequestRef.current && selectedPidRef.current === pid) {
        setIsCheckingCloud(false);
      }
    }
  };

  useEffect(() => {
    if (isOpen) {
      setPinConfig(getStoredPinLockConfig());
      setRoleState(getCurrentUserRole());
      setAuditLogs(getAuditLogs());
      const pid = activeProjectId || (projects[0]?.id || 'default');
      setSelectedPid(pid);
      setPinMsg(null);
      setClaimMsg(null);
      setNewPin('');
      setConfirmPin('');
      setCurrentPinInput('');
      setAdminPinPrompt(false);
      setAdminPinInput('');
      setAdminPinError('');
      setMemberMsg(null);
      refreshCloudStatus(pid);
    }
  }, [isOpen, activeProjectId, projects]);

  useEffect(() => {
    if (!selectedPid) return;
    let cancelled = false;
    setProjectMembers(getProjectMembers(selectedPid));
    setMemberMsg(null);
    refreshCloudStatus(selectedPid);

    // Firestore is the permission source of truth. Keep this screen live while it is open.
    const unsubMembers = subscribeProjectMembersRealtime(selectedPid, (cloudMembers) => {
      if (cancelled || selectedPidRef.current !== selectedPid) return;
      const normalized = cloudMembers
        .filter((m: any) => m && m.email && m.active !== false)
        .map((m: any) => ({
          email: String(m.email).trim().toLowerCase(),
          role: (m.role || 'VIEWER') as UserRole,
          assignedAt: Number(m.assignedAt || m.updatedAt || Date.now()),
        }));
      saveProjectMembers(selectedPid, normalized); // local cache only
      setProjectMembers(normalized);
      refreshCloudStatus(selectedPid);
    });

    const unsubAudit = subscribeProjectAuditLogsRealtime(selectedPid, (cloudLogs) => {
      if (cancelled || selectedPidRef.current !== selectedPid) return;
      const normalized = cloudLogs.map((log: any) => ({
        ...log,
        timestamp: Number(log.clientTimestamp || log.timestamp || 0),
        details: log.description || log.details || log.action,
        userEmail: log.userEmail || log.actorEmail || '',
        userName: log.userName || log.actorName || '',
      }));
      setAuditLogs(normalized as any);
    }, 200);

    return () => { cancelled = true; unsubMembers(); unsubAudit(); };
  }, [selectedPid]);

  if (!isOpen) return null;

  const handleSavePin = async () => {
    setPinMsg(null);

    if (pinConfig.enabled && pinConfig.pinHash) {
      // Must verify existing PIN first if changing
      if (!currentPinInput) {
        setPinMsg({ type: 'error', text: 'Vui lòng nhập mã PIN hiện tại để thay đổi.' });
        return;
      }
      const isMatch = await verifyPin(currentPinInput, pinConfig.pinHash, pinConfig.pinSalt || '');
      if (!isMatch) {
        setPinMsg({ type: 'error', text: 'Mã PIN hiện tại không chính xác!' });
        return;
      }
    }

    if (newPin.length < 4 || newPin.length > 6 || !/^\d+$/.test(newPin)) {
      setPinMsg({ type: 'error', text: 'Mã PIN mới phải từ 4 đến 6 chữ số (chỉ gồm số 0-9).' });
      return;
    }

    if (newPin !== confirmPin) {
      setPinMsg({ type: 'error', text: 'Mã PIN xác nhận không trùng khớp.' });
      return;
    }

    try {
      const { hash, salt } = await hashPin(newPin);
      const currentUser = getCurrentFirebaseUser();
      const updated = {
        ...pinConfig,
        enabled: true,
        pinHash: hash,
        pinSalt: salt,
        pinOwnerUid: currentUser?.uid || pinConfig.pinOwnerUid,
        pinOwnerEmail: currentUser?.email || pinConfig.pinOwnerEmail
      };
      savePinLockConfig(updated);
      setPinConfig(updated);
      setNewPin('');
      setConfirmPin('');
      setCurrentPinInput('');
      logAuditAction('SECURITY_CONFIG_CHANGE', 'Đã thiết lập hoặc đổi mã PIN ứng dụng');
      setPinMsg({ type: 'success', text: '🎉 Thiết lập mã PIN bảo mật thành công!' });
    } catch (err: any) {
      setPinMsg({ type: 'error', text: 'Lỗi khi lưu mã PIN: ' + (err?.message || err) });
    }
  };

  const handleDisablePin = async () => {
    if (!currentPinInput) {
      setPinMsg({ type: 'error', text: 'Vui lòng nhập mã PIN hiện tại để tắt bảo vệ.' });
      return;
    }
    const isMatch = await verifyPin(currentPinInput, pinConfig.pinHash || '', pinConfig.pinSalt || '');
    if (!isMatch) {
      setPinMsg({ type: 'error', text: 'Mã PIN hiện tại không đúng.' });
      return;
    }

    const updated = {
      ...pinConfig,
      enabled: false,
      pinHash: undefined,
      pinSalt: undefined,
      pinOwnerUid: undefined,
      pinOwnerEmail: undefined
    };
    savePinLockConfig(updated);
    setPinConfig(updated);
    setCurrentPinInput('');
    logAuditAction('SECURITY_CONFIG_CHANGE', 'Đã tắt khóa mã PIN ứng dụng');
    setPinMsg({ type: 'success', text: 'Đã tắt chức năng khóa PIN thành công.' });
  };

  const handleAutoLockChange = (minutes: number) => {
    const updated = { ...pinConfig, autoLockMinutes: minutes };
    savePinLockConfig(updated);
    setPinConfig(updated);
  };

  const handleLockOnBgChange = (val: boolean) => {
    const updated = { ...pinConfig, lockOnBackground: val };
    savePinLockConfig(updated);
    setPinConfig(updated);
  };

  const handleResetPinWithGoogleInModal = async () => {
    if (typeof window !== 'undefined' && !window.navigator.onLine) {
      setPinMsg({ type: 'error', text: 'Cần kết nối Internet để xác minh tài khoản và đặt lại mã PIN.' });
      return;
    }

    try {
      setPinMsg(null);
      const user = await signInWithGoogle();
      if (user && user.email) {
        try {
          const { saveUserProfileToCloud } = await import('../lib/firebase');
          await saveUserProfileToCloud(user);
        } catch (_) {}

        if (pinConfig.pinOwnerUid && pinConfig.pinOwnerUid !== user.uid) {
          setPinMsg({ type: 'error', text: 'Tài khoản này không có quyền đặt lại mã PIN.' });
          return;
        }

        if (newPin && newPin.length >= 4 && newPin.length <= 6 && /^\d+$/.test(newPin)) {
          if (newPin !== confirmPin) {
            setPinMsg({ type: 'error', text: 'Mã PIN xác nhận không trùng khớp.' });
            return;
          }
          const { hash, salt } = await hashPin(newPin);
          const updated = {
            ...pinConfig,
            enabled: true,
            pinHash: hash,
            pinSalt: salt,
            pinOwnerUid: user.uid,
            pinOwnerEmail: user.email
          };
          savePinLockConfig(updated);
          setPinConfig(updated);
          setNewPin('');
          setConfirmPin('');
          setCurrentPinInput('');
          logAuditAction('SECURITY_CONFIG_CHANGE', `Đã đặt lại PIN mới thành công qua xác thực Google Auth (${user.email})`);
          setPinMsg({ type: 'success', text: `🎉 Đã đặt mã PIN mới thành công qua xác thực Google (${user.email})!` });
        } else {
          const updated = {
            ...pinConfig,
            enabled: false,
            pinHash: undefined,
            pinSalt: undefined,
            pinOwnerUid: undefined,
            pinOwnerEmail: undefined
          };
          savePinLockConfig(updated);
          setPinConfig(updated);
          setCurrentPinInput('');
          logAuditAction('SECURITY_CONFIG_CHANGE', `Đã đặt lại/xóa mã PIN qua xác thực Google Auth (${user.email})`);
          setPinMsg({ type: 'success', text: `🎉 Xác thực Google Auth thành công (${user.email})! Mã PIN cũ đã được xóa. Bạn có thể nhập Mã PIN mới và bấm "Lưu Mã PIN".` });
        }
      } else {
        setPinMsg({ type: 'error', text: 'Đăng nhập Google thất bại hoặc bị hủy.' });
      }
    } catch (err: any) {
      setPinMsg({ type: 'error', text: 'Lỗi xác thực Google: ' + (err?.message || err) });
    }
  };

  const handleClaimOwnership = async () => {
    if (!selectedPid) return;
    let u = getCurrentFirebaseUser();
    if (!u) {
      try {
        u = await signInWithGoogle();
        if (!u) return;
        setCloudUser(u);
      } catch (e: any) {
        setClaimMsg({ type: 'error', text: 'Lỗi đăng nhập Google: ' + (e?.message || e) });
        return;
      }
    }
    if (!u) {
      setClaimMsg({ type: 'error', text: 'Vui lòng đăng nhập tài khoản Google để thực hiện.' });
      return;
    }
    setIsClaiming(true);
    setClaimMsg(null);
    try {
      const res = await claimProjectOwnership(selectedPid, u, getSelectedProjectName(selectedPid));
      if (res.success) {
        setClaimMsg({ type: 'success', text: res.message });
        await refreshCloudStatus(selectedPid);
        logAuditAction('SECURITY_CONFIG_CHANGE', `Khôi phục/xác nhận quyền Chủ sở hữu dự án (${selectedPid}) bởi ${u.email}`);
      } else {
        setClaimMsg({ type: 'error', text: res.message });
      }
    } catch (err: any) {
      setClaimMsg({ type: 'error', text: 'Lỗi: ' + (err?.message || err) });
    } finally {
      setIsClaiming(false);
    }
  };

  const handleVerifyAdminWithGoogle = async () => {
    try {
      setAdminPinError('');
      const user = await signInWithGoogle();
      if (user && user.email) {
        setAdminPinPrompt(false);
        setAdminPinInput('');
        setAdminPinError('');
        await refreshCloudStatus(selectedPid);
        alert(`🎉 Xác thực Google Auth thành công (${user.email}). Vai trò tài khoản của bạn được áp dụng theo phân quyền Cloud/Dự án.`);
      } else {
        setAdminPinError('Xác thực Google thất bại.');
      }
    } catch (err: any) {
      setAdminPinError('Lỗi xác thực Google: ' + (err?.message || err));
    }
  };

  const handleChangeRole = async (role: UserRole) => {
    alert('⚠️ Phân quyền vai trò người dùng được quản lý bởi Quản trị viên dự án và được đồng bộ từ Cloud. Bạn không thể tự thay đổi vai trò cá nhân.');
  };

  const handleVerifyAdminPin = async () => {
    if (!adminPinInput) {
      setAdminPinError('Vui lòng nhập mã PIN bảo mật.');
      return;
    }
    const isMatch = await verifyPin(adminPinInput, pinConfig.pinHash || '', pinConfig.pinSalt || '');
    if (!isMatch) {
      setAdminPinError('Mã PIN không chính xác.');
      return;
    }

    setAdminPinPrompt(false);
    setAdminPinInput('');
    setAdminPinError('');
    alert('Mã PIN hợp lệ!');
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberEmail.trim()) {
      alert('Vui lòng nhập email thành viên!');
      return;
    }
    const email = newMemberEmail.trim().toLowerCase();
    const assignedAt = Date.now();
    addProjectMember(selectedPid, {
      email,
      role: newMemberRole,
      assignedAt
    });
    
    // Sync to cloud
    try {
      const { saveProjectMemberToCloud } = await import('../lib/firebase');
      await saveProjectMemberToCloud(selectedPid, { email, role: newMemberRole, assignedAt });
    } catch (_) {}

    setProjectMembers(getProjectMembers(selectedPid));
    setNewMemberEmail('');
    logAuditAction('ROLE_CHANGE', `Đã gán quyền ${newMemberRole} cho email ${email} ở dự án ${selectedPid}`, selectedPid);
  };

  const handleRemoveMember = async (email: string) => {
    if (confirm(`Xác nhận thu hồi quyền truy cập của ${email}?`)) {
      removeProjectMember(selectedPid, email);

      // Sync removal to cloud
      try {
        const { removeProjectMemberFromCloud } = await import('../lib/firebase');
        await removeProjectMemberFromCloud(selectedPid, email);
      } catch (_) {}

      setProjectMembers(getProjectMembers(selectedPid));
      logAuditAction('ROLE_CHANGE', `Đã xóa quyền thành viên của ${email} ở dự án ${selectedPid}`, selectedPid);
    }
  };

  const countAdmins = (members: ProjectMember[]) => members.filter(m => m.role === 'ADMIN').length;

  const getSelectedProjectName = (projectId: string) =>
    projects.find(p => p.id === projectId)?.name || projectId || 'Dự án';

  const ensureCloudAdminForMemberWrite = async (projectId: string) => {
    let u = getCurrentFirebaseUser();
    if (!u) {
      u = await signInWithGoogle();
      if (!u) {
        throw new Error('Can dang nhap Google bang tai khoan ADMIN/Owner de dong bo phan quyen Cloud.');
      }
      setCloudUser(u);
    }

    const info = await fetchProjectUserRoleFromCloud(projectId, u);
    if (info.allowed && info.role === 'ADMIN') {
      setCloudRoleInfo(info);
      return u;
    }

    const claimResult = await claimProjectOwnership(projectId, u, getSelectedProjectName(projectId));
    if (!claimResult.success) {
      throw new Error(claimResult.message || 'Tai khoan hien tai khong co quyen ADMIN tren Cloud cho du an nay.');
    }

    const refreshedInfo = await fetchProjectUserRoleFromCloud(projectId, u);
    setCloudRoleInfo(refreshedInfo);
    if (!refreshedInfo.allowed || refreshedInfo.role !== 'ADMIN') {
      throw new Error('Da khoi phuc owner nhung chua xac nhan duoc quyen ADMIN Cloud. Hay thu dong bo lai.');
    }

    return u;
  };

  const handleAddMemberSafe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingMember) return;

    const pidAtSubmit = selectedPid;
    const email = newMemberEmail.trim().toLowerCase();
    if (!email) {
      setMemberMsg({ type: 'error', text: 'Vui long nhap email thanh vien.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMemberMsg({ type: 'error', text: 'Email thanh vien khong hop le.' });
      return;
    }

    const existingMembers = getProjectMembers(pidAtSubmit);
    const existingMember = existingMembers.find(m => m.email.toLowerCase() === email);
    if (existingMember?.role === 'ADMIN' && newMemberRole !== 'ADMIN' && countAdmins(existingMembers) <= 1) {
      setMemberMsg({ type: 'error', text: 'Khong the ha quyen ADMIN cuoi cung cua du an. Hay them/chuyen mot ADMIN khac truoc.' });
      return;
    }

    const assignedAt = Date.now();
    setIsSavingMember(true);
    setMemberMsg(null);

    try {
      addProjectMember(pidAtSubmit, { email, role: newMemberRole, assignedAt });
      if (selectedPidRef.current === pidAtSubmit) {
        setProjectMembers(getProjectMembers(pidAtSubmit));
      }

      await ensureCloudAdminForMemberWrite(pidAtSubmit);

      const { saveProjectMemberToCloud } = await import('../lib/firebase');
      await saveProjectMemberToCloud(pidAtSubmit, { email, role: newMemberRole, assignedAt });

      if (selectedPidRef.current === pidAtSubmit) {
        setProjectMembers(getProjectMembers(pidAtSubmit));
        setNewMemberEmail('');
        setMemberMsg({ type: 'success', text: `Da luu quyen ${newMemberRole} cho ${email}.` });
        await refreshCloudStatus(pidAtSubmit);
      }
      logAuditAction('ROLE_CHANGE', `Da gan quyen ${newMemberRole} cho email ${email} o du an ${pidAtSubmit}`, pidAtSubmit);
    } catch (err: any) {
      if (selectedPidRef.current === pidAtSubmit) {
        setProjectMembers(getProjectMembers(pidAtSubmit));
        setMemberMsg({
          type: 'error',
          text: `Da luu offline cho ${email}, nhung chua dong bo Cloud: ${err?.message || err}`
        });
      }
    } finally {
      if (selectedPidRef.current === pidAtSubmit) {
        setIsSavingMember(false);
      }
    }
  };

  const handleRemoveMemberSafe = async (email: string) => {
    const pidAtSubmit = selectedPid;
    const existingMembers = getProjectMembers(pidAtSubmit);
    const targetMember = existingMembers.find(m => m.email.toLowerCase() === email.toLowerCase());
    if (targetMember?.role === 'ADMIN' && countAdmins(existingMembers) <= 1) {
      setMemberMsg({ type: 'error', text: 'Khong the xoa ADMIN cuoi cung cua du an. Hay them/chuyen mot ADMIN khac truoc.' });
      return;
    }

    if (confirm(`XÃ¡c nháº­n thu há»“i quyá»n truy cáº­p cá»§a ${email}?`)) {
      setIsSavingMember(true);
      setMemberMsg(null);
      try {
        removeProjectMember(pidAtSubmit, email);
        if (selectedPidRef.current === pidAtSubmit) {
          setProjectMembers(getProjectMembers(pidAtSubmit));
        }

        const { removeProjectMemberFromCloud } = await import('../lib/firebase');
        await removeProjectMemberFromCloud(pidAtSubmit, email);

        if (selectedPidRef.current === pidAtSubmit) {
          setProjectMembers(getProjectMembers(pidAtSubmit));
          setMemberMsg({ type: 'success', text: `Da xoa quyen cua ${email}.` });
          await refreshCloudStatus(pidAtSubmit);
        }
        logAuditAction('ROLE_CHANGE', `Da xoa quyen thanh vien cua ${email} o du an ${pidAtSubmit}`, pidAtSubmit);
      } catch (err: any) {
        if (selectedPidRef.current === pidAtSubmit) {
          setProjectMembers(getProjectMembers(pidAtSubmit));
          setMemberMsg({
            type: 'error',
            text: `Da xoa offline, nhung chua dong bo Cloud: ${err?.message || err}`
          });
        }
      } finally {
        if (selectedPidRef.current === pidAtSubmit) {
          setIsSavingMember(false);
        }
      }
    }
  };

  const handleExportLogsSafe = async () => {
    const json = JSON.stringify(auditLogs, null, 2);
    await saveTextFile(json, `Nhat_Ky_Bao_Mat_${new Date().toISOString().split('T')[0]}.json`, 'application/json;charset=utf-8');
  };

  const handleClearLogs = () => {
    if (confirm('Chỉ xóa bộ nhớ đệm nhật ký trên thiết bị này? Nhật ký Cloud của dự án vẫn được giữ nguyên và không thể xóa từ ứng dụng.')) {
      clearAuditLogs();
      // Cloud activityLogs are append-only. Keep the currently rendered realtime list;
      // the Firestore listener remains the source of truth for the selected project.
    }
  };

  const handleExportLogs = () => {
    void handleExportLogsSafe();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/65 backdrop-blur-xs z-[200] flex items-center justify-center p-3 md:p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-lg rounded-2xl p-4 md:p-6 shadow-2xl relative border border-slate-100 flex flex-col max-h-[92vh] overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-2.5 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 sm:p-2.5 bg-indigo-600 text-white rounded-xl shadow-md shrink-0">
              <Shield className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-extrabold text-slate-800 leading-tight">
                Trung tâm bảo mật &amp; phân quyền
              </h2>
              <p className="text-[10px] sm:text-[11px] text-slate-500 font-medium">
                Khóa ứng dụng, phân quyền và mã hóa bảo mật
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 p-1.5 sm:p-2 rounded-full transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl mt-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('pin')}
            className={`py-2 px-1 sm:px-2 rounded-lg font-bold text-[11px] sm:text-xs flex items-center justify-center gap-1 transition-all cursor-pointer ${
              activeTab === 'pin'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Lock className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Khóa Mã PIN</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('rbac')}
            className={`py-2 px-1 sm:px-2 rounded-lg font-bold text-[11px] sm:text-xs flex items-center justify-center gap-1 transition-all cursor-pointer ${
              activeTab === 'rbac'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Phân Quyền</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            className={`py-2 px-1 sm:px-2 rounded-lg font-bold text-[11px] sm:text-xs flex items-center justify-center gap-1 transition-all cursor-pointer ${
              activeTab === 'audit'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Nhật ký</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-4 pt-3 text-xs">

          {/* TAB 1: PIN LOCK */}
          {activeTab === 'pin' && (
            <div className="space-y-4">
              
              {/* Security Policy Notice */}
              <div className="p-3 bg-indigo-50/80 border border-indigo-200 rounded-2xl text-[11px] text-indigo-900 space-y-1">
                <div className="font-extrabold flex items-center gap-1.5 text-indigo-950">
                  <Shield className="w-4 h-4 text-indigo-600" />
                  <span>NGUYÊN TẮC BẢO MẬT MÃ PIN &amp; QUÊN PIN:</span>
                </div>
                <p className="leading-relaxed text-[10.5px] opacity-90">
                  Mã PIN chỉ dùng để khóa màn hình ứng dụng trên thiết bị và được băm 1 chiều PBKDF2 SHA-256. <strong>Tuyệt đối không có mã PIN master</strong>. PIN cũ không thể khôi phục hay giải mã. Nếu quên mã PIN, bạn có thể nhấn nút <strong>"Đặt lại PIN bằng Google Auth"</strong> để đăng nhập lại tài khoản Google và thiết lập PIN mới.
                </p>
              </div>

              {/* Status banner */}
              <div className={`p-3.5 rounded-2xl border flex items-center justify-between ${
                pinConfig.enabled && pinConfig.pinHash
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                  : 'bg-amber-50/70 border-amber-200 text-amber-900'
              }`}>
                <div className="flex items-center gap-2.5">
                  <div className={`p-2 rounded-xl text-white ${pinConfig.enabled && pinConfig.pinHash ? 'bg-emerald-600' : 'bg-amber-500'}`}>
                    {pinConfig.enabled && pinConfig.pinHash ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                  </div>
                  <div>
                    <h4 className="font-extrabold text-xs">
                      {pinConfig.enabled && pinConfig.pinHash ? 'Khóa Mã PIN Đang BẬT' : 'Khóa Mã PIN Chưa Thiết Lập'}
                    </h4>
                    <p className="text-[10.5px] opacity-80 mt-0.5">
                      {pinConfig.enabled && pinConfig.pinHash
                        ? 'Ứng dụng sẽ tự động khóa khi rời khỏi hoặc sau thời gian chờ.'
                        : 'Bảo vệ dữ liệu công trình trên thiết bị không bị người khác tự ý xem.'}
                    </p>
                  </div>
                </div>

                {pinConfig.enabled && pinConfig.pinHash && (
                  <button
                    type="button"
                    onClick={() => {
                      onLockNow();
                      onClose();
                    }}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-[11px] font-bold shrink-0 transition-colors shadow-xs"
                  >
                    Khóa Ngay
                  </button>
                )}
              </div>

              {/* Status notification */}
              {pinMsg && (
                <div className={`p-2.5 rounded-xl border flex items-center gap-2 text-xs ${
                  pinMsg.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}>
                  {pinMsg.type === 'success' ? <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />}
                  <span>{pinMsg.text}</span>
                </div>
              )}

              {/* Set or Change PIN Form */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                <h4 className="font-extrabold text-slate-800 text-xs flex items-center gap-1.5">
                  <Key className="w-4 h-4 text-indigo-600" />
                  <span>{pinConfig.enabled && pinConfig.pinHash ? 'Đổi mã PIN Mới' : 'Thiết lập mã PIN'}</span>
                </h4>

                {pinConfig.enabled && pinConfig.pinHash && (
                  <div>
                    <label className="text-[10.5px] font-bold text-slate-600 block mb-1">
                      Mã PIN hiện tại:
                    </label>
                    <input
                      type={showPinInput ? 'text' : 'password'}
                      maxLength={6}
                      value={currentPinInput}
                      onChange={e => setCurrentPinInput(e.target.value.replace(/\D/g, ''))}
                      placeholder="Nhập mã PIN cũ"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono text-center tracking-widest focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10.5px] font-bold text-slate-600 block mb-1">
                      Mã PIN mới (4-6 số):
                    </label>
                    <input
                      type={showPinInput ? 'text' : 'password'}
                      maxLength={6}
                      value={newPin}
                      onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
                      placeholder="VD: 1234"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono text-center tracking-widest focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10.5px] font-bold text-slate-600 block mb-1">
                      Xác nhận mã PIN:
                    </label>
                    <input
                      type={showPinInput ? 'text' : 'password'}
                      maxLength={6}
                      value={confirmPin}
                      onChange={e => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                      placeholder="Nhập lại mã PIN"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono text-center tracking-widest focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/60 mt-2">
                  <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-500">
                    <input
                      type="checkbox"
                      checked={showPinInput}
                      onChange={e => setShowPinInput(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Hiện chữ số khi nhập</span>
                  </label>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={handleResetPinWithGoogleInModal}
                      className="px-3 py-1.5 bg-slate-200/80 hover:bg-slate-300 text-slate-800 rounded-xl font-bold text-[11px] transition-colors flex items-center gap-1 cursor-pointer"
                      title="Xác thực Google Auth để đặt lại PIN mới mà không cần biết PIN cũ"
                    >
                      <UserCheck className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Quên PIN? Đặt lại bằng Google</span>
                    </button>

                    {pinConfig.enabled && pinConfig.pinHash && (
                      <button
                        type="button"
                        onClick={handleDisablePin}
                        className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl font-bold text-[11px] transition-colors cursor-pointer"
                      >
                        Tắt Mã PIN
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleSavePin}
                      className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-[11px] transition-colors shadow-xs cursor-pointer"
                    >
                      Lưu Mã PIN
                    </button>
                  </div>
                </div>
              </div>

              {/* Auto-Lock Settings */}
              {pinConfig.enabled && pinConfig.pinHash && (
                <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3">
                  <h4 className="font-extrabold text-slate-800 text-xs flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-indigo-600" />
                    <span>Cài Đặt Tự Động Khóa</span>
                  </h4>

                  <div className="grid grid-cols-4 gap-1.5">
                    {[
                      { label: '1 phút', val: 1 },
                      { label: '5 phút', val: 5 },
                      { label: '15 phút', val: 15 },
                      { label: '30 phút', val: 30 }
                    ].map(opt => (
                      <button
                        key={opt.val}
                        type="button"
                        onClick={() => handleAutoLockChange(opt.val)}
                        className={`py-2 px-1 rounded-xl text-[11px] font-bold transition-all ${
                          pinConfig.autoLockMinutes === opt.val
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  <label className="flex items-center gap-2 p-2 rounded-xl hover:bg-slate-50 cursor-pointer pt-2">
                    <input
                      type="checkbox"
                      checked={pinConfig.lockOnBackground}
                      onChange={e => handleLockOnBgChange(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                    />
                    <span className="text-[11px] font-semibold text-slate-700">
                      Tự động khóa ngay khi chuyển sang ứng dụng / tab khác
                    </span>
                  </label>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: RBAC */}
          {activeTab === 'rbac' && (
            <div className="space-y-4">
              {/* Admin PIN elevation prompt modal if needed */}
              {adminPinPrompt && (
                <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-2xl space-y-2.5 animate-in fade-in">
                  <div className="flex items-center gap-2 text-amber-900 font-extrabold text-xs">
                    <Lock className="w-4 h-4 text-amber-700" />
                    <span>Xác Thực Nâng Quyền Quản Trị Viên (Admin)</span>
                  </div>
                  <p className="text-[10.5px] text-amber-800 leading-relaxed">
                    Ứng dụng đang được bảo vệ bởi mã PIN. Vui lòng nhập đúng mã PIN để chuyển sang vai trò Quản Trị Viên:
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="password"
                      maxLength={6}
                      value={adminPinInput}
                      onChange={e => {
                        setAdminPinInput(e.target.value.replace(/\D/g, ''));
                        setAdminPinError('');
                      }}
                      placeholder="Mã PIN (4-6 số)"
                      className="w-36 px-3 py-1.5 bg-white border border-amber-300 rounded-xl text-xs font-mono text-center tracking-widest focus:ring-2 focus:ring-amber-500"
                    />
                    <button
                      type="button"
                      onClick={handleVerifyAdminPin}
                      className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
                    >
                      Xác Nhận PIN
                    </button>
                    <button
                      type="button"
                      onClick={handleVerifyAdminWithGoogle}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center gap-1"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Xác thực bằng Google</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdminPinPrompt(false)}
                      className="px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-xl text-xs font-semibold cursor-pointer"
                    >
                      Hủy
                    </button>
                  </div>
                  {adminPinError && (
                    <p className="text-[10px] text-rose-600 font-bold">{adminPinError}</p>
                  )}
                </div>
              )}

              {/* Cloud Account & Security Status */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3.5">
                <div className="flex items-center justify-between">
                  <h4 className="font-extrabold text-slate-800 text-xs flex items-center gap-1.5">
                    <Shield className="w-4 h-4 text-indigo-600" />
                    <span>Chứng Thực &amp; Phân Quyền Cloud (Firebase)</span>
                  </h4>
                  <button
                    type="button"
                    onClick={() => refreshCloudStatus(selectedPid)}
                    disabled={isCheckingCloud}
                    className="px-2 py-1 text-[10px] font-bold text-slate-600 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <RefreshCw className={`w-3 h-3 ${isCheckingCloud ? 'animate-spin' : ''}`} />
                    <span>Làm mới</span>
                  </button>
                </div>

                {/* Current Google User Details */}
                <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {cloudUser?.photoURL ? (
                        <img
                          src={cloudUser.photoURL}
                          alt="Avatar"
                          className="w-8 h-8 rounded-full border border-slate-200"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs">
                          <UserIcon className="w-4 h-4" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-bold text-slate-800 text-xs truncate">
                          {cloudUser?.displayName || 'Tài khoản Google'}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono truncate">
                          {cloudUser?.email || 'Chưa đăng nhập Google'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {currentRole === 'ADMIN' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300">
                          <Crown className="w-3 h-3 text-emerald-600" />
                          ADMIN (Chỉ Huy Trưởng)
                        </span>
                      ) : currentRole === 'ENGINEER' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-extrabold bg-indigo-100 text-indigo-800 border border-indigo-300">
                          <Users className="w-3 h-3 text-indigo-600" />
                          ENGINEER (Kỹ sư Giám Sát)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-extrabold bg-slate-100 text-slate-700 border border-slate-300">
                          <Eye className="w-3 h-3 text-slate-500" />
                          VIEWER (Người Xem / Chỉ Đọc)
                        </span>
                      )}
                    </div>
                  </div>

                  {cloudUser && (
                    <div className="pt-2 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10.5px]">
                      <div>
                        <span className="text-slate-400 font-medium">Google UID: </span>
                        <span className="font-mono text-slate-700 select-all font-semibold">{cloudUser.uid}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 font-medium">Chủ dự án (Owner): </span>
                        <span className="font-semibold text-slate-700">
                          {cloudRoleInfo?.isOwner ? (
                            <span className="text-emerald-600 font-bold">Chính bạn (Project Owner)</span>
                          ) : cloudRoleInfo?.ownerEmail ? (
                            <span>{cloudRoleInfo.ownerEmail}</span>
                          ) : (
                            <span className="text-amber-600">Chưa liên kết Chủ sở hữu</span>
                          )}
                        </span>
                      </div>
                    </div>
                  )}

                  {!cloudUser && (
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={async () => {
                          const u = await signInWithGoogle();
                          if (u) refreshCloudStatus(selectedPid);
                        }}
                        className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-2"
                      >
                        <UserCheck className="w-4 h-4" />
                        <span>Đăng nhập Google để xác thực quyền</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Claim / Recover Ownership Action */}
                {(!cloudRoleInfo?.isOwner || currentRole !== 'ADMIN') && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div className="text-[11px] text-amber-900 leading-relaxed">
                        <span className="font-bold">Xác minh lại quyền chủ dự án: </span>
                        Nếu tài khoản Google hiện tại là chủ dự án hoặc dự án chưa có chủ hợp lệ trên đám mây, hãy xác minh lại để khôi phục quyền quản trị.
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={handleClaimOwnership}
                        disabled={isClaiming}
                        className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50"
                      >
                        <Crown className="w-3.5 h-3.5" />
                        <span>{isClaiming ? 'Đang xác thực...' : 'Xác minh quyền chủ dự án'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const u = await signInWithGoogle();
                          if (u) refreshCloudStatus(selectedPid);
                        }}
                        className="px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold cursor-pointer"
                      >
                        Đổi tài khoản Google
                      </button>
                    </div>

                    {claimMsg && (
                      <div className={`p-2 rounded-lg text-[10.5px] font-bold ${claimMsg.type === 'success' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-rose-100 text-rose-800 border border-rose-200'}`}>
                        {claimMsg.text}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Roles matrix info */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2.5">
                <h4 className="font-extrabold text-slate-800 text-xs flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-slate-600" />
                  <span>Quyền theo vai trò</span>
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[10.5px]">
                  <div className="p-3 bg-white rounded-xl border border-emerald-200 space-y-1">
                    <div className="font-bold text-emerald-800 flex items-center gap-1">
                      <Crown className="w-3.5 h-3.5 text-emerald-600" />
                      ADMIN (Chỉ Huy Trưởng)
                    </div>
                    <p className="text-slate-500 leading-relaxed">
                      Toàn quyền: Tạo/xóa dự án, cấu hình định mức, xem đơn giá, xuất/nhập sao lưu toàn bộ, quản lý thành viên và bảo mật.
                    </p>
                  </div>
                  <div className="p-3 bg-white rounded-xl border border-indigo-200 space-y-1">
                    <div className="font-bold text-indigo-800 flex items-center gap-1">
                      <Users className="w-3.5 h-3.5 text-indigo-600" />
                      ENGINEER (Kỹ sư Thi Công)
                    </div>
                    <p className="text-slate-500 leading-relaxed">
                      Cập nhật tiến độ phòng, khối lượng, defect, chấm công, ảnh hiện trường. Không xem đơn giá và không thể xóa/quản lý dự án.
                    </p>
                  </div>
                  <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1">
                    <div className="font-bold text-slate-700 flex items-center gap-1">
                      <Eye className="w-3.5 h-3.5 text-slate-500" />
                      VIEWER (Chỉ xem)
                    </div>
                    <p className="text-slate-500 leading-relaxed">
                      Chế độ chỉ đọc: Xem tiến độ, mặt bằng, khuyết tật, ảnh đính kèm và báo cáo. Bị khóa mọi thao tác sửa đổi dữ liệu.
                    </p>
                  </div>
                </div>
              </div>

              {/* Project-specific Members Whitelist */}
              <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h4 className="font-extrabold text-slate-800 text-xs flex items-center gap-1.5">
                    <Shield className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Thành viên & phân quyền dự án</span>
                  </h4>
                  {projects.length > 0 && (
                    <select
                      value={selectedPid}
                      onChange={e => setSelectedPid(e.target.value)}
                      className="px-2 py-1.5 text-[11px] font-semibold border border-slate-200 rounded-lg bg-slate-50 text-slate-700 w-full sm:w-auto max-w-full sm:max-w-[180px] truncate"
                    >
                      {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                </div>

                <form onSubmit={handleAddMemberSafe} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
                  <input
                    type="email"
                    value={newMemberEmail}
                    onChange={e => setNewMemberEmail(e.target.value)}
                    disabled={isSavingMember}
                    placeholder="email.nhanvien@gmail.com"
                    className="flex-1 min-w-0 w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500"
                  />
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={newMemberRole}
                      onChange={e => setNewMemberRole(e.target.value as UserRole)}
                      disabled={isSavingMember}
                      className="flex-1 sm:flex-initial px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700"
                    >
                      <option value="ENGINEER">Kỹ sư</option>
                      <option value="VIEWER">Chỉ xem</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                    <button
                      type="submit"
                      disabled={isSavingMember}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shrink-0 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Thêm
                    </button>
                  </div>
                </form>

                {memberMsg && (
                  <div className={`p-2 rounded-xl text-[10.5px] font-bold border ${
                    memberMsg.type === 'success'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border-rose-200'
                  }`}>
                    {memberMsg.text}
                  </div>
                )}

                <div className="space-y-1 pt-1 max-h-36 overflow-y-auto">
                  {projectMembers.length === 0 ? (
                    <p className="text-[10px] text-slate-400 italic py-2 text-center">
                      Chưa có thành viên riêng cho dự án này (Áp dụng quyền chung của thiết bị).
                    </p>
                  ) : (
                    projectMembers.map(m => (
                      <div
                        key={m.email}
                        className="flex items-center justify-between p-2 bg-slate-50 rounded-xl border border-slate-100 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="min-w-0">
                            {m.displayName && <div className="font-bold text-slate-800 truncate">{m.displayName}</div>}
                            <div className="font-semibold text-slate-600 truncate">{m.email}</div>
                          </div>
                          <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-extrabold uppercase ${
                            m.role === 'ADMIN'
                              ? 'bg-rose-100 text-rose-700'
                              : m.role === 'ENGINEER'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-slate-200 text-slate-700'
                          }`}>
                            {m.role === 'ADMIN' ? 'Admin' : m.role === 'ENGINEER' ? 'Kỹ sư' : 'Chỉ xem'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveMemberSafe(m.email)}
                          disabled={isSavingMember}
                          className="text-rose-500 hover:text-rose-700 p-1 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: AUDIT LOG */}
          {activeTab === 'audit' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-extrabold text-slate-700 uppercase tracking-wider">
                  Nhật ký hoạt động ({auditLogs.length})
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleExportLogsSafe}
                    disabled={auditLogs.length === 0}
                    className="px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors disabled:opacity-40"
                  >
                    <Download className="w-3 h-3" />
                    <span>Xuất JSON</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleClearLogs}
                    disabled={auditLogs.length === 0}
                    className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors disabled:opacity-40"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Xóa cache máy</span>
                  </button>
                </div>
                <p className="text-[9.5px] text-slate-400">
                  “Xóa cache máy” chỉ xóa bản nhật ký lưu tạm trên thiết bị này; nhật ký hoạt động trên Firestore không bị xóa.
                </p>
              </div>

              <div className="text-[9.5px] text-slate-500 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                Nhật ký được đồng bộ realtime theo đúng dự án đang mở.
              </div>

              {auditLogs.length === 0 ? (
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 text-center text-slate-400 space-y-1">
                  <FileText className="w-8 h-8 mx-auto opacity-30 mb-1" />
                  <p className="font-bold text-xs">Chưa có bản ghi nhật ký nào</p>
                  <p className="text-[10px]">Các thao tác quan trọng sẽ được tự động lưu vết tại đây.</p>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                  {auditLogs.map(log => (
                    <details
                      key={log.id}
                      className="group p-2.5 bg-white border border-slate-200 rounded-xl text-xs hover:bg-slate-50/50 transition-colors"
                    >
                      <summary className="cursor-pointer list-none">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-extrabold text-indigo-800 text-[10.5px] truncate">{log.action}</div>
                            <div className="text-[10px] text-slate-700 mt-0.5 line-clamp-2">{log.details}</div>
                          </div>
                          <span className="text-[9px] text-slate-400 font-mono shrink-0">
                            {new Date(log.timestamp).toLocaleString('vi-VN')}
                          </span>
                        </div>
                      </summary>
                      <div className="pt-2 mt-2 border-t border-slate-100 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-slate-400">
                        {log.actorEmail && <span>Tài khoản: <strong className="text-slate-600">{log.actorEmail}</strong></span>}
                        <span>Vai trò: <strong>{log.actorRole || '—'}</strong></span>
                        {(log as any).deviceName && <span>• Thiết bị: <strong className="text-slate-600">{(log as any).deviceName}</strong></span>}
                        {(log as any).deviceId && <span className="font-mono">({String((log as any).deviceId).slice(-8)})</span>}
                        {log.projectId && <span>• Dự án: {log.projectId}</span>}
                      </div>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-100 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
