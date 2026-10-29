import React from 'react';
import { createRoot } from 'react-dom/client';
import { BottomNav } from '../../../src/components/BottomNav';
import '../../../src/index.css';
const state = { account: 0, lock: 0, signOut: 0 };
(window as any).__testNav = state;
createRoot(document.getElementById('root')!).render(
  <>
    <main data-hnl-fixture-content="true" className="min-h-screen bg-slate-50 p-4 text-slate-800 lg:pl-24">
      <h1>HNL QLTC - Desktop Account Menu Fixture</h1>
    </main>
    <BottomNav activeTab="home" setActiveTab={() => undefined} defectBadgeCount={0}
      chatBadgeCount={0} showChecklist showAi={false} showSuperAdmin={false}
      userRole="ADMIN" roleResolved online hasPendingSync={false}
      onOpenAccount={() => { state.account++; }}
      onLockNow={() => { state.lock++; }}
      onSignOut={async () => { state.signOut++; }} />
  </>
);
