#!/bin/bash
exec 1> x.txt 2>&1
echo  $*

