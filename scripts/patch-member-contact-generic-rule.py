from pathlib import Path
p=Path('firestore.rules')
s=p.read_text()
old="collectionName != 'activityLogs' && collectionName != 'members' && collectionName != 'conversations' && collectionName != 'inventory_balances'"
new="collectionName != 'activityLogs' && collectionName != 'members' && collectionName != 'memberContacts' && collectionName != 'conversations' && collectionName != 'inventory_balances'"
count=s.count(old)
if count != 4:
    raise SystemExit(f'expected 4 generic guards, found {count}')
p.write_text(s.replace(old,new))
print('patched 4 generic guards to exclude private memberContacts')
