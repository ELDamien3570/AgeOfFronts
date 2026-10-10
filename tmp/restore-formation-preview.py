import json,re,subprocess
from pathlib import Path
root=Path.cwd();target=root/'tests/skirmish/browser/FormationFixes.ts';realwrite=Path.write_text
def guardedwrite(self,data,*args,**kwargs):
 if self.resolve()!=target.resolve():return len(data)
 kwargs['encoding']='utf-8';return realwrite(self,data,*args,**kwargs)
Path.write_text=guardedwrite
fmt=lambda:subprocess.run(['node','node_modules/prettier/bin/prettier.cjs','--write',str(target)],check=True,capture_output=True)
realwrite(target,Path('tmp/recover-11395-0-0.txt').read_text(encoding='utf-8'),encoding='utf-8');fmt()
for name in ['11466-0-0','11517-0-0','11551-0-0','11574-0-0','11597-0-0','11792-0-1','11942-0-0']:
 exec(compile(Path('tmp/recover-'+name+'.txt').read_text(encoding='utf-8'),name,'exec'),{});fmt()
def patch_from(i):
 code=Path(f'tmp/recover-{i}.txt').read_text(encoding='utf-8')
 for m in re.finditer(r'apply_patch\(("(?:\\.|[^"\\])*")\)',code):
  patch=json.loads(m.group(1));active=False;old=[];new=[];cursor=0
  def flush():
   nonlocal old,new,cursor
   if not old and not new:return
   a='\n'.join(old)+'\n';b='\n'.join(new)+'\n';s=target.read_text(encoding='utf-8')
   pos=s.find(a,cursor)
   if pos<0:raise RuntimeError(f'Patch {i} missing context {a[:110]}')
   realwrite(target,s[:pos]+b+s[pos+len(a):],encoding='utf-8');cursor=pos+len(b);old=[];new=[]
  for line in patch.splitlines():
   if line.startswith('*** Update File:') or line.startswith('*** End Patch'):
    if active:flush()
    active=line.startswith('*** Update File:') and line.endswith('/FormationFixes.ts')
   elif active:
    if line.startswith('@@'):
     flush()
     anchor=line[2:].strip()
     if anchor:
      found=target.read_text(encoding='utf-8').find(anchor,cursor)
      if found>=0:cursor=found
    elif line.startswith(' '):old.append(line[1:]);new.append(line[1:])
    elif line.startswith('-'):old.append(line[1:])
    elif line.startswith('+'):new.append(line[1:])
  if active:flush()
for i in [12189,12247,12266,12320]:patch_from(i);fmt()
# Recover this turn's prepared replacement, now with explicit UTF-8 writes.
exec(compile(Path('tmp/recover-12320-0-0.txt').read_text(encoding='utf-8'),'latest-preview','exec'),{});fmt()
print('Restored prior preview edits and installed new damage scene:',target.stat().st_size,'bytes')

