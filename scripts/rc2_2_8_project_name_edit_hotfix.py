from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'PATCH ASSERTION FAILED: {path}: expected 1 occurrence, found {count}\n{old}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')
    print('PATCHED', path)

replace_once(
    'src/components/GoogleAuthHeader.tsx',
    """  useEffect(() => {\n    if (userRole !== 'ADMIN' && isEditingProject) setIsEditingProject(false);\n  }, [userRole, isEditingProject]);\n\n  useEffect(() => {\n    checkAuthStatus();""",
    """  useEffect(() => {\n    if (userRole !== 'ADMIN' && isEditingProject) setIsEditingProject(false);\n  }, [userRole, isEditingProject]);\n\n  // Keep the edit draft aligned with the project currently shown in the header.\n  // Without this, the component can keep the initial fallback ('Dự án chưa đặt tên')\n  // after switching/hydrating another project and then commit that stale value on blur.\n  useEffect(() => {\n    if (!isEditingProject) setTempProjectName(projectName);\n  }, [projectName, projectId, isEditingProject]);\n\n  useEffect(() => {\n    checkAuthStatus();"""
)

replace_once(
    'src/components/GoogleAuthHeader.tsx',
    """                      onBlur={() => {\n                        if (tempProjectName.trim()) setProjectName(tempProjectName.trim());\n                        setIsEditingProject(false);\n                      }}\n                      onKeyDown={(e) => {\n                        if (e.key === 'Enter') {\n                          if (tempProjectName.trim()) setProjectName(tempProjectName.trim());\n                          setIsEditingProject(false);\n                        }\n                      }}""",
    """                      onBlur={() => {\n                        const nextName = tempProjectName.trim();\n                        if (nextName && nextName !== projectName) setProjectName(nextName);\n                        setIsEditingProject(false);\n                      }}\n                      onKeyDown={(e) => {\n                        if (e.key === 'Enter') {\n                          const nextName = tempProjectName.trim();\n                          if (nextName && nextName !== projectName) setProjectName(nextName);\n                          setIsEditingProject(false);\n                        }\n                      }}"""
)

replace_once(
    'src/components/GoogleAuthHeader.tsx',
    """                      onClick={() => { if (userRole === 'ADMIN') setIsEditingProject(true); }}""",
    """                      onClick={() => {\n                        if (userRole === 'ADMIN') {\n                          // Snapshot the visible/current project name at the exact moment edit starts.\n                          setTempProjectName(projectName);\n                          setIsEditingProject(true);\n                        }\n                      }}"""
)

replace_once(
    'scripts/rbac-matrix.mjs',
    """check('Project title editing remains ADMIN-only', has(src.header, \"userRole === 'ADMIN'\", 'Chỉ ADMIN được sửa thông tin dự án'));""",
    """check('Project title editing remains ADMIN-only', has(src.header, \"userRole === 'ADMIN'\", 'Chỉ ADMIN được sửa thông tin dự án'));\ncheck('Project title editor snapshots current project name instead of stale default', has(src.header, 'if (!isEditingProject) setTempProjectName(projectName);', 'setTempProjectName(projectName);', 'nextName && nextName !== projectName'));"""
)

print('RC2.2.8 PROJECT NAME EDIT HOTFIX PATCH COMPLETE')
