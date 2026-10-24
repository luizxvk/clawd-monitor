param([string]$K)
# Chamado pela tarefa agendada "Claude limite renovou - <K>". O console fica escondido e o node herda ele.
& node "$PSScriptRoot\renovou.js" $K
