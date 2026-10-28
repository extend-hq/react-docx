import collections
import re
from corpus import norm


def core_block_paragraphs(data):
    paragraphs=[]
    ids=set()
    audit={'blocks':0,'duplicate_ids':0,'missing_references':0,'wrong_document_references':0}
    def walk(block):
        audit['blocks']+=1
        if block['id'] in ids:
            audit['duplicate_ids']+=1
        ids.add(block['id'])
        refs=block.get('sourceRefs',[])
        if not refs:
            audit['missing_references']+=1
        audit['wrong_document_references']+=sum(r.get('documentId')!=data.get('documentId') for r in refs)
        story=refs[0].get('story','body') if refs else 'body'
        story={'footnote':'footnotes','endnote':'endnotes','comment':'comments'}.get(story,story)
        details=block.get('details',{})
        if 'inlines' in details or (details.get('kind')=='text_box' and not block.get('children')):
            if norm(block.get('content','')):
                paragraphs.append({'text':block['content'],'story':story})
        for item in block.get('children',[]):
            walk(item)
    for block in data.get('blocks',[]):
        walk(block)
    return paragraphs,audit


def normalize(engine, data):
    paragraphs = []
    features = collections.defaultdict(list)
    seen = set()

    def feature(name, story, text='', **kw):
        features[name].append({'story':story,'text':norm(text),**kw})

    def paragraph(text, story, runs=(), heading=None, listing=False, textbox=False, table=False):
        if not norm(text):
            return
        paragraphs.append({'text':text,'story':story,'textbox':textbox,'table':table})
        if heading:
            feature('headings',story,text,value=int(heading))
        if listing:
            feature('lists',story,text)
        if textbox:
            feature('textbox_text',story,text)
        for key in ['explicit_bold','explicit_italic','hyperlinks']:
            current = ''
            for run in [*runs,{}]:
                value = run.get({'explicit_bold':'bold','explicit_italic':'italic','hyperlinks':'link'}[key])
                if value:
                    current += run.get('text','')
                elif current:
                    feature(key,story,current,paragraph=norm(text))
                    current = ''

    def table_feature(story, cells, nested):
        text = ''.join(c[0] for c in cells)
        feature('tables',story,text)
        if nested:
            feature('nested_tables',story,text)
        for text,col,row in cells:
            if norm(text):
                feature('table_cells',story,text)
            if col>1:
                feature('horizontal_merges',story,text,value=col)
            if row>1:
                feature('vertical_merges',story,text)

    if engine == 'docx-core':
        def walk(nodes,story='body',table=False,box=False):
            for n in nodes or []:
                kind=n.get('type')
                if kind=='paragraph':
                    runs=[]
                    nested=[]
                    for c in n.get('children',[]):
                        if c.get('type')=='text':
                            runs.append({'text':c.get('text',''),**(c.get('style') or {}),'link':c.get('link')})
                        elif c.get('type')=='form-field':
                            if c.get('fieldType')!='checkbox':
                                runs.append({'text':c.get('displayValue',c.get('value','')),**(c.get('style') or {}),'link':c.get('link')})
                            elif c.get('sourceKind')=='sdt':
                                runs.append({'text':c.get('checkedSymbol','☒') if c.get('checked') else c.get('uncheckedSymbol','☐'),**(c.get('style') or {})})
                        elif c.get('type')=='image':
                            if c.get('mathMl'):
                                feature('equations',story)
                            elif c.get('contentNodes'):
                                nested.extend(c['contentNodes'])
                            elif c.get('syntheticTextBox') and c.get('textBoxText'):
                                paragraph(c['textBoxText'],story,textbox=True,table=table)
                            elif c.get('src') or c.get('data') or c.get('partName'):
                                feature('images',story)
                    s=n.get('style') or {}
                    paragraph(''.join(r.get('text','') for r in runs),story,runs,s.get('headingLevel'),s.get('numbering') is not None,box,table)
                    walk(nested,story,table,True)
                elif kind=='table':
                    cells=[]
                    for row in n.get('rows',[]):
                        for cell in row.get('cells',[]):
                            start=len(paragraphs)
                            walk(cell.get('nodes'),story,True,box)
                            text=''.join(p['text'] for p in paragraphs[start:])
                            s=cell.get('style') or {}
                            cells.append((text,s.get('colSpan',s.get('gridSpan',1)) or 1,s.get('rowSpan',1) or 1))
                    table_feature(story,cells,table)
        walk(data.get('nodes'))
        meta=data.get('metadata',{})
        for key,story in [('headerSections','header'),('footerSections','footer')]:
            for section in [meta,*meta.get('sections',[])]:
                for item in section.get(key,[]) or []:
                    ident=item.get('partName') or item.get('id') or repr(item.get('nodes'))
                    if (story,ident) not in seen:
                        seen.add((story,ident))
                        walk(item.get('nodes'),story)
        for story in ['footnotes','endnotes','comments']:
            for item in meta.get(story,[]) or []:
                walk(item.get('nodes'),story)

    elif engine == 'undoc':
        def para(p,story,table=False,box=False):
            runs=[{'text':r.get('text',''),**r.get('style',{}),'link':r.get('hyperlink')} for r in p.get('runs',[]) if r.get('revision')!='deleted']
            heading=p.get('heading','None')
            paragraph(''.join(r['text'] for r in runs),story,runs,int(heading[1:]) if heading.startswith('H') else None,p.get('list_info',{}).get('list_type','none')!='none',box,table)
            for _ in p.get('images',[]):
                feature('images',story)
        def walk(nodes,story='body',table=False):
            for n in nodes or []:
                kind=n.get('type')
                if kind=='Paragraph':
                    para(n,story,table)
                elif kind=='Table':
                    cells=[]
                    for row in n.get('rows',[]):
                        for cell in row.get('cells',[]):
                            start=len(paragraphs)
                            for p in cell.get('content',[]):
                                para(p,story,True)
                            walk([dict(t,type='Table') for t in cell.get('nested_tables',[])],story,True)
                            cells.append((''.join(p['text'] for p in paragraphs[start:]),cell.get('col_span',1),cell.get('row_span',1)))
                    table_feature(story,cells,table)
                elif kind=='Note':
                    for p in n.get('content',[]):
                        para(p,'endnotes' if n.get('label','').startswith('e') else 'footnotes')
                elif kind=='Image':
                    feature('images',story)
        for section in data.get('sections',[]):
            walk(section.get('content'))
            for story in ['header','footer']:
                items=section.get(story,[]) or []
                ident=repr(items)
                if (story,ident) not in seen:
                    seen.add((story,ident))
                    for p in items:
                        para(p,story)

    elif engine == 'office_oxide':
        def inline(items,story):
            runs=[]
            for item in items or []:
                kind=item.get('type')
                if kind=='text':
                    runs.append({'text':item.get('text',''),**item,'link':item.get('hyperlink')})
                elif kind=='hyperlink':
                    rs=inline(item.get('content',item.get('runs',[])),story)
                    for r in rs:
                        r['link']=True
                    runs.extend(rs)
                elif kind=='image':
                    feature('images',story)
                elif kind in ['line_break','tab']:
                    runs.append({'text':' '})
                elif kind=='field':
                    runs.extend(inline(item.get('content',item.get('result',[])),story))
            return runs
        def walk(nodes,story='body',table=False,box=False,listing=False):
            for n in nodes or []:
                kind=n.get('type')
                if kind in ['paragraph','heading']:
                    runs=inline(n.get('content',[]),story)
                    heading=n.get('level') if kind=='heading' else n.get('outline_level')+1 if n.get('outline_level',9)<9 else None
                    paragraph(''.join(r['text'] for r in runs),story,runs,heading,listing,box,table)
                elif kind=='list':
                    for item in n.get('items',[]):
                        walk(item.get('content',[]),story,table,box,True)
                        if item.get('nested'):
                            walk([dict(item['nested'],type='list')],story,table,box,True)
                elif kind=='table':
                    cells=[]
                    for row in n.get('rows',[]):
                        for cell in row.get('cells',[]):
                            start=len(paragraphs)
                            walk(cell.get('content'),story,True,box)
                            cells.append((''.join(p['text'] for p in paragraphs[start:]),cell.get('col_span',1),cell.get('row_span',1)))
                    table_feature(story,cells,table)
                elif kind=='text_box':
                    walk(n.get('content'),story,table,True)
                elif kind in ['footnote','endnote']:
                    walk(n.get('content'),'comments' if kind=='endnote' and (n.get('marker') or '').startswith('Comment') else kind+'s')
                elif kind=='image':
                    feature('images',story)
                elif kind=='code_block':
                    paragraph(n.get('code',''),story,table=table)
        for section in data.get('sections',[]):
            walk(section.get('elements'))
            for key in ['header','footer','first_page_header','first_page_footer','even_page_header','even_page_footer']:
                item=section.get(key)
                if item:
                    story=key.split('_')[-1]
                    ident=repr(item)
                    if (story,ident) not in seen:
                        seen.add((story,ident))
                        walk(item.get('content',[]),story)

    elif engine == 'docx-rs':
        def un(n):
            return n.get('data',n) if isinstance(n,dict) else n
        styles={s.get('styleId'):s for s in data.get('styles',{}).get('styles',[])}
        def property_chain(prop):
            yield prop
            sid=prop.get('style')
            if isinstance(sid,dict):
                sid=sid.get('val')
            visited=set()
            while sid in styles and sid not in visited:
                visited.add(sid)
                st=styles[sid]
                yield st.get('paragraphProperty',{})
                sid=st.get('basedOn')
        def inline(items,story,table,box,style=None,link=False,nested=None):
            if nested is None:
                nested=[]
            runs=[]
            for n in items or []:
                kind=n.get('type')
                d=un(n)
                if kind in ['delete','moveFrom','deleteText','instrText','instrTextString','deleteInstrText']:
                    continue
                if kind=='text':
                    text=d.get('text','') if isinstance(d,dict) else str(d)
                    runs.append({'text':text,'bold':(style or {}).get('bold'),'italic':(style or {}).get('italic'),'link':link})
                elif kind in ['tab','break','carriageReturn','ptab']:
                    runs.append({'text':' '})
                elif kind=='run':
                    runs.extend(inline(d.get('children'),story,table,box,d.get('runProperty'),link,nested))
                elif kind=='hyperlink':
                    runs.extend(inline(d.get('children'),story,table,box,style,True,nested))
                elif kind in ['insert','moveTo','structuredDataTag']:
                    runs.extend(inline(d.get('children',d.get('content',[])),story,table,box,style,link,nested))
                elif kind in ['drawing','shape']:
                    def drawing(x):
                        if isinstance(x,dict):
                            if x.get('type')=='pic':
                                feature('images',story)
                                return
                            if x.get('imageData'):
                                feature('images',story)
                            if x.get('type')=='paragraph':
                                nested.append(x)
                                return
                            for k,v in x.items():
                                if k in ['pic','picture'] and v:
                                    feature('images',story)
                                drawing(v)
                        elif isinstance(x,list):
                            for v in x:
                                drawing(v)
                    drawing(d)
            return runs
        def headers(obj):
            if isinstance(obj,dict):
                for k,v in obj.items():
                    story='header' if 'header' in k.lower() else 'footer' if 'footer' in k.lower() else None
                    if story and isinstance(v,list) and len(v)==2 and isinstance(v[1],dict):
                        ident=v[0]
                        if (story,ident) not in seen:
                            seen.add((story,ident))
                            walk(v[1].get('children',[]),story)
                        continue
                    if story and isinstance(v,dict) and 'children' in v:
                        ident=repr(v)
                        if (story,ident) not in seen:
                            seen.add((story,ident))
                            walk(v['children'],story)
                    elif k!='children':
                        headers(v)
            elif isinstance(obj,list):
                for x in obj:
                    headers(x)
        def walk(nodes,story='body',table=False,box=False):
            for n in nodes or []:
                kind=n.get('type')
                d=un(n)
                if kind=='paragraph':
                    nested=[]
                    runs=inline(d.get('children'),story,table,box,nested=nested)
                    prop=d.get('property',{})
                    chain=list(property_chain(prop))
                    outline=next((p['outlineLevel'] for p in chain if p.get('outlineLevel') is not None),None)
                    if isinstance(outline,dict):
                        outline=outline.get('val')
                    heading=int(outline)+1 if outline is not None and int(outline)<9 else None
                    if not heading:
                        s=prop.get('style','')
                        if isinstance(s,str) and re.fullmatch(r'Heading[1-9]',s,re.I):
                            heading=int(s[-1])
                    listing=d.get('hasNumbering') or any(p.get('numberingProperty') for p in chain)
                    paragraph(''.join(r['text'] for r in runs),story,runs,heading,listing,box,table)
                    walk(nested,story,table,True)
                    headers(prop)
                elif kind=='table':
                    cells=[]
                    for row in d.get('rows',[]):
                        for cell in un(row).get('cells',[]):
                            c=un(cell)
                            start=len(paragraphs)
                            walk(c.get('children'),story,True,box)
                            p=c.get('property',{})
                            span=p.get('gridSpan',1)
                            if isinstance(span,dict):
                                span=span.get('val',1)
                            cells.append((''.join(p['text'] for p in paragraphs[start:]),int(span or 1),2 if p.get('verticalMerge')=='restart' else 1))
                    table_feature(story,cells,table)
                elif kind in ['section','structuredDataTag','tableOfContents']:
                    walk(d.get('children',d.get('content',[])),story,table,box)
                    headers(d)
        walk(data.get('document',{}).get('children'))
        headers(data.get('document',{}).get('sectionProperty',{}))
        for story in ['footnotes','comments']:
            items=data.get(story,{})
            for item in items.get(story,[]) if isinstance(items,dict) else items:
                d=un(item)
                if str(d.get('id','1')).startswith('-'):
                    continue
                walk(d.get('children',d.get('content',[])),story)

    return {'paragraphs':paragraphs,'features':dict(features)}
