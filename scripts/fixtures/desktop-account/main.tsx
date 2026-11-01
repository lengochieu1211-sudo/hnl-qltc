import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BottomNav } from '../../../src/components/BottomNav';
import '../../../src/index.css';

const state = { account: 0, lock: 0, signOut: 0, lastSection: '' };
(window as any).__testNav = state;

function Fixture() {
  const [section, setSection] = useState('none');
  const chooseSection = (next: 'account' | 'switch' | 'rbac') => {
    state.account += 1;
    state.lastSection = next;
    setSection(next);
  };
  return (
    <>
      <main data-hnl-fixture-content="true" className="min-h-screen bg-slate-50 p-4 text-slate-800 lg:pl-24">
        <h1>HNL QLTC - Desktop Account Menu Fixture</h1>
        <output data-hnl-account-selected-section="true">{section}</output>
      </main>
      <BottomNav activeTab="home" setActiveTab={() => undefined} defectBadgeCount={0}
        chatBadgeCount={0} showChecklist showAi={false} showSuperAdmin={false}
        userRole="ADMIN" roleResolved online hasPendingSync={false}
        onOpenAccount={chooseSection}
        onLockNow={() => { state.lock++; setSection('pin'); }}
        onSignOut={async () => { state.signOut++; }} />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
