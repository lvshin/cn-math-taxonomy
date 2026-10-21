#!/usr/bin/env python3
"""独立重算复用题与新增数值题的校验表达式；不等于题意或教师审核。"""
import ast
import json
from fractions import Fraction
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def calc(node):
    if isinstance(node,ast.Expression):return calc(node.body)
    if isinstance(node,ast.Constant):
        return Fraction(str(node.value)) if isinstance(node.value,(int,float)) else node.value
    if isinstance(node,ast.UnaryOp) and isinstance(node.op,(ast.UAdd,ast.USub)):
        value=calc(node.operand)
        return -value if isinstance(node.op,ast.USub) else value
    if isinstance(node,ast.BinOp):
        a,b=calc(node.left),calc(node.right)
        if isinstance(node.op,ast.Add):return a+b
        if isinstance(node.op,ast.Sub):return a-b
        if isinstance(node.op,ast.Mult):return a*b
        if isinstance(node.op,ast.Div):return a/b
    raise ValueError('Unsupported verification expression')

def normalized(value):
    try:return Fraction(str(value).strip())
    except (ValueError,ZeroDivisionError):return str(value).strip()

if __name__=='__main__':
    questions=json.loads((ROOT/'data/questions.json').read_text())
    counts={'upstream-reused':0,'suzhou-supplement':0}
    for q in questions:
        if q['origin'] not in counts or (q['origin']=='suzhou-supplement' and q['type']!='numeric'):continue
        value=calc(ast.parse(q['verify'],mode='eval'))
        answer=q['answer']
        if q['type']=='choice':answer=next(c['text'] for c in q['choices'] if c['key']==answer)
        # 上游 verify 的运算表达式与题面分别维护；此处只重算表达式，题意仍需人工核对。
        if normalized(value)!=normalized(answer):raise AssertionError((q['id'],str(value),answer))
        counts[q['origin']]+=1
    print(f'独立表达式核验：复用题{counts["upstream-reused"]}题、新增数值题{counts["suzhou-supplement"]}题通过；选项题意及教师审核不在此自动核验范围。')
