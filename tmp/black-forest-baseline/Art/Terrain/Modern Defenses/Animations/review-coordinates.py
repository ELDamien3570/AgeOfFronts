from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parent
review=Image.new('RGB',(1536,768),'#283128'); font=ImageFont.truetype('C:/Windows/Fonts/consola.ttf',14)
for index,name in enumerate(['AntiInfantry','AntiAir']):
    image=Image.open(ROOT.parent/'Gun Nests'/f'{name}_N.png').convert('RGBA').resize((768,768),Image.Resampling.NEAREST)
    backdrop=Image.new('RGBA',image.size,'#6e7860'); backdrop.alpha_composite(image); draw=ImageDraw.Draw(backdrop)
    for value in range(0,256,16):
        point=value*3; draw.line((point,0,point,768),fill=(70,230,240,100),width=1); draw.line((0,point,768,point),fill=(70,230,240,100),width=1)
        draw.text((point+2,3),str(value),font=font,fill='#ffffff'); draw.text((3,point+2),str(value),font=font,fill='#ffffff')
    review.paste(backdrop.convert('RGB'),(index*768,0))
review.save(ROOT/'Source_Coordinate_Review.png')
