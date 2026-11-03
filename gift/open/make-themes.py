#!/usr/bin/env python3
"""ينسخ صفحة فتح الهدية لكل لون بطاقة، عشان معاينة واتساب تطلع بنفس لون البطاقة. شغّلوه بعد أي تعديل على gift/open/index.html."""
import os, re
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, 'index.html'), encoding='utf-8').read()
for t in ['oud', 'rose', 'gold', 'sand']:
    h = src.replace('../../', '../../../').replace('"../card', '"../../card')
    h = h.replace('https://beautfresh.com/gift/og-gift.jpg', f'https://beautfresh.com/gift/og-{t}.jpg')
    os.makedirs(os.path.join(here, t), exist_ok=True)
    open(os.path.join(here, t, 'index.html'), 'w', encoding='utf-8').write(h)
print('ok')
