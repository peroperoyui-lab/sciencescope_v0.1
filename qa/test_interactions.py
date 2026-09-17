"""Offline UI verification with Chromium. No live models, user data or external pages."""
from pathlib import Path
import json,time,traceback
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'ScienceScope.html').read_text()
results=[];errors=[]

def check(name,fn):
    try:
        detail=fn()
        results.append({'name':name,'status':'PASS','detail':detail})
        print('PASS',name,flush=True)
    except Exception as e:
        results.append({'name':name,'status':'FAIL','error':str(e)})
        print('FAIL',name,str(e)[:240],flush=True)

def expect(condition,message='Assertion failed'):
    if not condition: raise AssertionError(message)

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    ctx=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
    pg=ctx.new_page();pg.set_default_timeout(2500)
    pg.on('pageerror',lambda e:errors.append(str(e)))
    def reset(route='work'):
        global pg
        pg.close();pg=ctx.new_page();pg.set_default_timeout(2500);pg.on('pageerror',lambda e:errors.append(str(e)))
        pg.set_content(HTML);pg.evaluate(f"SS.navigate('{route}')");pg.wait_for_timeout(70)
    def nav(route):
        pg.evaluate(f"SS.navigate('{route}')");pg.wait_for_timeout(60)
    def click(sel):pg.locator(sel).first.click()
    reset()
    routes=pg.evaluate('PAGE_SPECS.map(p=>p.route)')
    for r in routes:
        def f(r=r):
            nav(r);expect(pg.locator('#app').count()>0);expect(pg.locator('body').inner_text().strip()!='');expect(not errors,repr(errors));return 'Rendered'
        check('route:'+r,f)
    reset()
    def menu_test():
        for i in range(4):
            click(f'[data-v="top-menu"][data-menu="{i}"]');expect(pg.locator('#v-menu').count()==1);expect(pg.locator('#modal').count()==0)
            pg.keyboard.press('ArrowDown');expect(pg.evaluate("document.activeElement.closest('#v-menu')!==null"));pg.keyboard.press('Escape');expect(pg.locator('#v-menu').count()==0)
        return '4 menus; keyboard navigation; no modal'
    check('top menus and Escape',menu_test)
    def contextual():
        click('[data-v="object-menu"][data-kind="chat"][data-id="e-theory"]');first=pg.locator('#v-menu').inner_text();pg.keyboard.press('Escape')
        pg.locator('[data-object="chat"][data-object-id="e-theory"]').first.click(button='right');second=pg.locator('#v-menu').inner_text();expect(first==second);pg.keyboard.press('Escape')
        return first
    check('ellipsis matches right-click menu',contextual)
    def pin():
        before=pg.evaluate('SS.getState().pins');pg.evaluate("SSV2.selectProject('skills')");expect(before==pg.evaluate('SS.getState().pins'))
        pg.evaluate("SSV2.togglePin('chat','s-map')");expect(pg.evaluate("SS.getState().pins.some(p=>p.id==='s-map')"));pg.evaluate("SSV2.togglePin('chat','s-map')");expect(not pg.evaluate("SS.getState().pins.some(p=>p.id==='s-map')"));return 'Manual pins are independent of active project'
    check('manual pin stability',pin)
    reset()
    def collapse():
        click('[data-v="toggle-project"][data-id="employment"]');expect(pg.locator('.tree-row.child [data-v="select-chat"][data-id="e-lit"]').count()==0)
        click('[data-v="toggle-project"][data-id="employment"]');expect(pg.locator('.tree-row.child [data-v="select-chat"][data-id="e-lit"]').count()==1)
    check('project expand collapse',collapse)
    def fixed():
        before=pg.locator('.browse-all').bounding_box()['y'];pg.locator('.navscroll').evaluate('(e)=>e.scrollTop=9999');after=pg.locator('.browse-all').bounding_box()['y'];expect(before==after)
        click('[data-v="all-chats"]');expect(pg.locator('h1').inner_text()=='全部对话');expect(pg.locator('#allchat-search').count()==1)
    check('browse all fixed and functional',fixed)
    def filter_search():
        pg.locator('#allchat-search').fill('培养');expect(pg.locator('.chat-table tbody tr').count()==1)
        pg.locator('#allchat-search').fill('');click('[data-v="filter-chats"][data-filter="archived"]');expect(pg.locator('.chat-table tbody tr').count()==1)
    check('all conversations search archive filter',filter_search)
    reset()
    def overview():
        click('#overview-trigger');expect(pg.locator('#project-flyout').count()==1);expect(pg.locator('.rightpanel').count()==0)
        expect(pg.locator('#project-flyout').get_attribute('aria-modal')=='false')
        click('[data-v="browser"]');expect(pg.locator('#project-flyout').count()==1);expect(pg.locator('#overview-trigger').is_visible());expect(pg.locator('.browser-panel').count()==1)
        click('#project-flyout [data-v="overview-close"]');click('.browser-panel [data-v="close-panel"]');expect(pg.locator('.browser-panel').count()==0);expect(pg.locator('#overview-trigger').is_visible())
    check('overview flyout coexists with browser',overview)
    def usage():
        pg.locator('[data-usage="main"]').hover();expect(pg.locator('#usage-pop').count()==1);text=pg.locator('#usage-pop').inner_text();expect('46,080 / 128,000' in text);expect('缓存读取' in text);expect('批注' not in text)
        pg.locator('.mainhead strong').hover();expect(pg.locator('#usage-pop').count()==0)
    check('usage hover distinct from annotations',usage)
    def dates():
        expect(pg.locator('.day-separator').count()>0);expect(pg.locator('.message time').count()>0)
        user=pg.locator('.message.user').first.bounding_box();body=pg.locator('.messages').bounding_box();expect(user['x']>body['x']+body['width']*.35)
        expect(pg.locator('.message.user [data-v="copy-message"]').count()>0);expect(pg.locator('.message.user [data-v="branch-message"]').count()>0)
    check('message alignment dates actions',dates)
    def copy():
        click('[data-v="copy-message"][data-id="example-1"]');expect('当前需要确认' in pg.evaluate('SSV2.copyValue()'));pg.keyboard.press('Escape')
    check('copy exact message content',copy)
    def branch():
        n=pg.evaluate('SS.getState().threads.length');click('[data-v="branch-message"][data-id="example-1"]');expect(pg.evaluate('SS.getState().threads.length')==n+1)
        expect(pg.evaluate('SSV2.allMessages().length')==2);expect(pg.evaluate('SS.getState().threads[0].branchFrom.messageId')=='example-1')
        expect(not pg.evaluate("SSV2.allMessages().some(m=>m.name==='Rosalin')"))
    check('branch only selected prefix',branch)
    reset()
    def drafts():
        pg.locator('[data-draft="main"]').fill('draft A');pg.evaluate("SSV2.loadThread('e-lit')");pg.locator('[data-draft="main"]').fill('draft B');pg.evaluate("SSV2.selectProject('skills')");pg.evaluate("SSV2.loadThread('e-theory')");expect(pg.locator('[data-draft="main"]').input_value()=='draft A');pg.evaluate("SSV2.loadThread('e-lit')");expect(pg.locator('[data-draft="main"]').input_value()=='draft B')
    check('per-thread drafts survive project switch',drafts)
    reset()
    def search():
        pg.keyboard.press('Control+f');pg.locator('#find-chat-input').fill('表述');expect(pg.locator('#find-count').inner_text()!='0 / 0');click('[data-v="find-next"]');expect(pg.locator('.msg-target').count()==1);pg.keyboard.press('Escape')
        pg.keyboard.press('Control+k');pg.locator('#command-query').fill('培养领域');expect(pg.locator('#command-results button').count()==1);pg.keyboard.press('Enter');expect(pg.evaluate('SS.getState().chatName')=='培养领域匹配')
    check('find current chat and command palette',search)
    reset('workbench')
    def record_create():
        before=pg.evaluate('SS.getState().plans.length');click('[data-v="new-record"][data-kind="plan"]');expect(pg.locator('#record-editor').get_attribute('aria-modal')=='false')
        click('[data-v="save-record"]');expect('标题' in pg.locator('#record-error').inner_text())
        pg.locator('#record-title').fill('new plan test');pg.locator('#record-text').fill('note');pg.evaluate("SSV2.appendRecordFiles([new File(['# method'], 'method.md', {type:'text/markdown'})])")
        expect(pg.locator('.file-chip').count()==1);click('[data-v="save-record"]');expect(pg.evaluate('SS.getState().plans.length')==before+1)
        expect(pg.evaluate('SS.getState().plans.at(-1).files[0].name')=='method.md');return 'create + validation + attached File'
    check('plan create and attachments',record_create)
    def record_edit_delete():
        id=pg.evaluate('SS.getState().plans.at(-1).id');pg.evaluate(f"SSV2.recordEditor('plan','{id}')");pg.locator('#record-title').fill('renamed');click('[data-v="save-record"]');expect(pg.evaluate('SS.getState().plans.at(-1).title')=='renamed')
        before=pg.evaluate('SS.getState().plans.length');pg.evaluate(f"SSV2.deleteRecord('plan','{id}')");expect(pg.evaluate('SS.getState().plans.length')==before-1);click('[data-v="undo-action"]');expect(pg.evaluate('SS.getState().plans.length')==before)
    check('plan edit delete undo',record_edit_delete)
    def journal():
        click('[data-v="new-record"][data-kind="log"]');pg.locator('#record-title').fill('journal test');pg.locator('#record-text').fill('finished review');pg.evaluate("SSV2.appendRecordFiles([new File(['x'],'result.txt',{type:'text/plain'})])");click('[data-v="save-record"]');expect(pg.evaluate('SS.getState().journals.at(-1).title')=='journal test')
        id=pg.evaluate('SS.getState().journals.at(-1).id');pg.locator(f'article[data-v="open-log"][data-id="{id}"]').click(position={'x':100,'y':20});expect(pg.locator('h1').inner_text()=='journal test');click('[data-v="log-tab"][data-tab="文件列表"]');expect('result.txt' in pg.locator('.log-body').inner_text());click('[data-v="delete-record"][data-kind="log"]');expect(not pg.evaluate(f"SS.getState().journals.some(j=>j.id==='{id}')"))
    check('journal create whole-card open files delete',journal)
    def isolation():
        pg.evaluate("SSV2.selectProject('skills')");expect('journal test' not in pg.locator('body').inner_text());expect('new plan test' not in pg.locator('body').inner_text());expect('renamed' in pg.locator('body').inner_text())
    check('project journals isolated global plans shared',isolation)
    reset()
    def location():
        nav('journal');click('[data-v="log-message"]');pg.wait_for_timeout(90);expect(pg.locator('.message.msg-target').count()==1)
    check('journal jump to exact message',location)
    reset('preview')
    def annotations_secretary():
        pg.evaluate("SS.addAnnotation('显著促进')");expect(pg.evaluate('SS.getState().annotations.length')==1)
        before=pg.evaluate('SS.getState().submitted.length');click('[data-action="ask-secretary"]');pg.wait_for_timeout(80);pg.locator('[data-draft="secretary"]').fill('please explain');click('[data-v="send"][data-scope="secretary"]');expect(pg.evaluate('SS.getState().annotations.length')==1);expect(pg.evaluate('SS.getState().submitted.length')==before)
    check('secretary preserves marks outside formal records',annotations_secretary)
    def fail_keep():
        pg.evaluate('SSV2.failNext()');pg.evaluate("SSV2.submit('please revise')");expect(pg.evaluate('SS.getState().annotations.length')==1);expect(pg.evaluate('SS.getState().submitted.length')==0)
    check('failed send preserves annotations',fail_keep)
    def concurrency_marks():
        pg.evaluate("window.pendingTest=SSV2.submit('revise old mark');SS.addAnnotation('另一个片段')")
        pg.wait_for_timeout(420);expect(pg.evaluate('SS.getState().annotations.length')==1);expect(pg.evaluate('SS.getState().annotations[0].quote')=='另一个片段');expect(pg.evaluate('SS.getState().submitted.length')==1)
    check('send receipt clears only submitted mark revisions',concurrency_marks)
    reset()
    def concurrency_project():
        pg.evaluate("window.pendingTest=SSV2.submit('unique A message');SSV2.loadThread('s-jobs')")
        pg.wait_for_timeout(430);expect('unique A message' not in pg.locator('.messages').inner_text());pg.evaluate("SSV2.loadThread('e-theory')");expect('unique A message' in pg.locator('.messages').inner_text())
    check('in-flight send remains in original thread',concurrency_project)
    reset()
    def browser_controls():
        click('[data-v="browser"]');pg.locator('#browser-address').fill('https://example.org/a');pg.locator('#browser-address').press('Enter');expect(pg.locator('#browser-address').input_value()=='https://example.org/a');click('[data-v="browser-back"]');expect('research.example' in pg.locator('#browser-address').input_value());click('[data-v="browser-forward"]');expect(pg.locator('#browser-address').input_value()=='https://example.org/a');click('[data-v="cite-page"]');expect('example.org/a' in pg.locator('.attachmentbar').inner_text())
    check('browser address back forward citation',browser_controls)
    reset()
    def detached():
        with pg.expect_popup() as pp:click('[data-v="open-global"]')
        child=pp.value;child.wait_for_timeout(150);expect(child.locator('.detached-shell').count()==1);expect(pg.locator('.messages').is_visible());child.locator('[data-v="toggle-orb"]').click();expect(child.locator('.assistant-orb').count()==1);child.locator('.assistant-orb').click();expect(child.locator('.detached-shell').count()==1);child.locator('[data-v="parent-route"][data-route-to="workbench"]').click();pg.wait_for_timeout(100);expect(pg.locator('.workbench').count()==1);child.close();return 'actual auxiliary browsing context; parent navigation'
    check('global assistant separate window orb parent action',detached)
    reset('workbench')
    def mapwin():
        with pg.expect_popup() as pp:click('[data-action="open-map"]')
        child=pp.value;child.wait_for_timeout(120);expect(child.locator('#mapviewport').count()==1);expect(pg.locator('.workbench').count()==1);child.close()
    check('mind map detached nonblocking editor',mapwin)
    reset()
    def newproject():
        nav('project-new');pg.locator('#new-project-name').fill('New empty project');click('[data-action="create-project"]');expect(pg.evaluate('SS.getState().project')=='New empty project');expect(pg.evaluate('SS.getState().journals.length')==0);expect(pg.evaluate('SS.getState().changes.length')==0)
    check('create project does not inherit other project logs',newproject)
    reset('map')
    def mapkeys():
        before=pg.evaluate('SS.getState().nodes.length');pg.locator('#node-editor').focus();pg.locator('#node-editor').press('Enter');expect(pg.evaluate('SS.getState().nodes.length')==before+1)
        before=pg.evaluate('SS.getState().nodes.length');pg.locator('#node-editor').press('Shift+Enter');expect(pg.evaluate('SS.getState().nodes.length')==before)
    check('existing map Enter ShiftEnter preserved',mapkeys)
    reset('work')
    def compact():
        click('[data-v="workspace-menu"]');click('[data-v="toggle-transcript"]');expect(pg.locator('.tool').first.is_hidden());click('[data-v="workspace-menu"]');click('[data-v="toggle-transcript"]');expect(pg.locator('.tool').first.is_visible())
    check('execution transcript density toggle',compact)
    for size in [(1280,800),(1100,750),(960,700),(768,900)]:
        def screen(size=size):
            pg.set_viewport_size({'width':size[0],'height':size[1]});nav('work');expect(pg.locator('[data-v="send"][data-scope="main"]').is_visible());expect(pg.evaluate('document.documentElement.scrollWidth')<=size[0]);
            x=pg.locator('[data-v="send"][data-scope="main"]').bounding_box();expect(x['y']+x['height']<=size[1]);return str(size)
        check('viewport '+str(size),screen)
    check('no JavaScript exceptions',lambda:expect(len(errors)==0,repr(errors)))
    out={'prototype':'ScienceScope v0.3','tested_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'method':'Chromium Playwright set_content; local/file navigation denied by environment policy, no policy altered','cases':results,'page_errors':errors,'passed':sum(x['status']=='PASS' for x in results),'failed':sum(x['status']=='FAIL' for x in results),'boundaries':['No live model or DSH runtime tested','No OS floating ball/always-on-top tested','Browser uses offline page fixture','Native file default application/Explorer not tested']}
    (ROOT/'qa/results.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
    print('TOTAL',out['passed'],out['failed'])
    browser.close()
