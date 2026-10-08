from pathlib import Path
p=Path(__file__).parent.parent/'Actor_Review.html'
s=p.read_text(encoding='utf-8')
for _ in range(2):s=s.encode('cp1252').decode('utf-8')
p.write_text(s,encoding='utf-8')
