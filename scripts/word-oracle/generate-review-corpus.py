from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from html import escape
import argparse
parser=argparse.ArgumentParser()
parser.add_argument('--out', type=Path, default=Path('output/playwright/revision-word-parity'))
root=parser.parse_args().out
root.mkdir(parents=True, exist_ok=True)
w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
ns=f'xmlns:w="{w}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"'
idx=0
def attrs(author='Reviewer'):
 global idx
 idx+=1
 return f'w:id="{idx}" w:author="{author}" w:date="2026-11-05T12:00:00Z"'
def r(t,props='',deleted=False):
 tag='delText' if deleted else 't'
 return f'<w:r><w:rPr>{props}</w:rPr><w:{tag} xml:space="preserve">{escape(t)}</w:{tag}></w:r>'
def p(s,props=''):
 spacing='' if props.startswith('<w:spacing') else '<w:spacing w:after="160"/>'
 return f'<w:p><w:pPr>{spacing}{props}</w:pPr>{s}</w:p>'
def change(kind,t,props='',author='Reviewer'):
 return f'<w:{kind} {attrs(author)}>{r(t,props,kind == "del")}</w:{kind}>'
def prop(kind,before):
 return f'<w:{kind} {attrs()}>{before}</w:{kind}>'
def cell(t,pr=''):return f'<w:tc><w:tcPr><w:tcW w:w="3800" w:type="dxa"/>{pr}</w:tcPr>{p(r(t))}</w:tc>'
def row(t,pr='',cpr=''):return f'<w:tr><w:trPr>{pr}</w:trPr>{cell(t,cpr)}</w:tr>'
def table(rows,pr='',grid=''):return '<w:tbl><w:tblPr><w:tblW w:w="3800" w:type="dxa"/>'+pr+'</w:tblPr><w:tblGrid><w:gridCol w:w="3800"/>'+grid+'</w:tblGrid>'+rows+'</w:tbl>'
def save(name,body,sect=''):
 with ZipFile(root/(name+'.docx'),'w',ZIP_DEFLATED) as z:
  z.writestr('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
  z.writestr('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  z.writestr('word/_rels/document.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
  z.writestr('word/styles.xml',f'<w:styles {ns}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>')
  z.writestr('word/document.xml',f'<w:document {ns}><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1000" w:bottom="1000" w:left="1000" w:right="1000"/>{sect}</w:sectPr></w:body></w:document>')
body=p(r('Text revisions','<w:b/>'))
body+=p(r('Insertion: ')+change('ins','added words')+r(' remain.'))
body+=p(r('Deletion: ')+change('del','removed words')+r('remain.'))
body+=p(r('Replacement: ')+change('del','old')+change('ins','new')+r(' wording.'))
body+=p(r('Move source: ')+f'<w:moveFromRangeStart w:id="100" w:name="move1" w:author="Reviewer" w:date="2026-11-05T12:00:00Z"/>'+change('moveFrom','relocated text')+'<w:moveFromRangeEnd w:id="100"/>')
body+=p(r('Move destination: ')+f'<w:moveToRangeStart w:id="101" w:name="move1" w:author="Reviewer" w:date="2026-11-05T12:00:00Z"/>'+change('moveTo','relocated text')+'<w:moveToRangeEnd w:id="101"/>')
body+=p(r('Inserted paragraph mark'),f'<w:rPr><w:ins {attrs()}/></w:rPr>')
body+=p(r('Deleted paragraph mark '),f'<w:rPr><w:del {attrs()}/></w:rPr>')+p(r('joins this paragraph.'))
body+=p(r('Other author: ')+change('ins','second reviewer',author='Editor'))
body+=p(r('Numeric text replacement: ')+change('del','3')+change('ins','4'))
body+=p(r('Deletion across a wrapped line: ')+change('del','removed text with enough words to wrap inside the review balloon and check its height without losing content.'))
save('text-revisions',body)
body=p(r('Formatting revisions','<w:b/>'))
body+=p(r('Bold instead of italic','<w:b/>'+prop('rPrChange','<w:rPr><w:i/></w:rPr>')))
body+=p(r('Font and size changed','<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="28"/>'+prop('rPrChange','<w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="22"/></w:rPr>')))
body+=p(r('Color and underline','<w:color w:val="0070C0"/><w:u w:val="single"/>'+prop('rPrChange','<w:rPr><w:color w:val="000000"/></w:rPr>')))
body+=p(r('Right aligned paragraph'),'<w:jc w:val="right"/>'+prop('pPrChange','<w:pPr><w:jc w:val="left"/></w:pPr>'))
body+=p(r('Indented paragraph'),'<w:ind w:left="720"/>'+prop('pPrChange','<w:pPr><w:ind w:left="0"/></w:pPr>'))
body+=p(r('Paragraph spacing'),'<w:spacing w:after="320"/>'+prop('pPrChange','<w:pPr><w:spacing w:after="0"/></w:pPr>'))
body+=table(row('Table alignment'),'<w:jc w:val="center"/>'+prop('tblPrChange','<w:tblPr><w:jc w:val="left"/></w:tblPr>'))+p(r(''))
body+=table(row('Table grid width'),grid=prop('tblGridChange','<w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>'))+p(r(''))
body+=table(row('Row height','<w:trHeight w:val="500"/>'+prop('trPrChange','<w:trPr><w:trHeight w:val="250"/></w:trPr>')))+p(r(''))
body+=table(row('Cell shading',cpr='<w:shd w:fill="FFF2CC"/>'+prop('tcPrChange','<w:tcPr><w:shd w:fill="FFFFFF"/></w:tcPr>')))+p(r('Section properties changed.'))
save('formatting-revisions',body,prop('sectPrChange','<w:sectPr><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr>'))
body=p(r('Table revisions','<w:b/>'))
body+=table(row('Inserted row',f'<w:ins {attrs()}/>')+row('Unchanged row'))+p(r(''))
body+=table(row('Removed row',f'<w:del {attrs()}/>')+row('Retained row'))+p(r(''))
body+=table(row('Inserted cell',cpr=f'<w:cellIns {attrs()}/>')+row('Deleted cell',cpr=f'<w:cellDel {attrs()}/>'))+p(r(''))
body+=table(row('Merged cell',cpr=f'<w:cellMerge {attrs()} w:vMerge="rest" w:vMergeOrig="cont"/>'))+p(r(''))
body+=table(row('Entire table removed',f'<w:del {attrs()}/>'))+p(r('After table.'))
save('table-revisions',body)
print(root)
