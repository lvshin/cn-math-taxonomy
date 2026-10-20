#!/usr/bin/env python3
"""独立重算复用题的180条校验表达式；不把它当作题意或教师审核。"""
import ast
import json
from fractions import Fraction
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def calc(node):
    if isinstance(node,ast.Expression):return calc(node.body)
    if isinstance(node,ast.Constant):
        return Fraction(str(node.value)) if isinstance(node.value,(int,float)) else node.value
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
    count=0
    for q in questions:
        if q['origin']!='upstream-reused':continue
        value=calc(ast.parse(q['verify'],mode='eval'))
        answer=q['answer']
        if q['type']=='choice':answer=next(c['text'] for c in q['choices'] if c['key']==answer)
        # 上游 verify 的运算表达式与题面分别维护；此处只重算表达式，题意仍需人工核对。
        if normalized(value)!=normalized(answer):raise AssertionError((q['id'],str(value),answer))
        count+=1
    print(f'复用题独立表达式核验：{count}题通过；重写题与题意不在此自动核验范围。')
