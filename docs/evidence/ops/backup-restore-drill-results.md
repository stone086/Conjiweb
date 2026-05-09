# Backup / Restore Drill Results

Status: PENDING_STAGING_RUN

## Drill summary

| Step | Result | Time | Evidence |
|---|---:|---:|---|
| Create staging test data | PENDING | PENDING | users/messages/uploads count |
| Run backup | PENDING | PENDING | backup file path + checksum |
| Restore into clean staging | PENDING | PENDING | restore log |
| Verify data integrity | PENDING | PENDING | counts before/after |
| Rollback drill | PENDING | PENDING | rollback log |

## Commands

```bash
sudo ./manage.sh backup
sudo ./manage.sh snapshot
sudo bash scripts/backup_restore_drill.sh --dry-run
```

Use destructive restore only on staging.
