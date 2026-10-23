# 从 SMPL-X 出发求解代谢能耗的完整链路

$$
\begin{aligned}
\mathrm{SMPL\!-\!X}
&\rightarrow \mathrm{Retargeting}
\rightarrow \mathrm{OpenSim} 
\rightarrow \mathrm{IK}
\\
&\rightarrow \mathrm{Joint\ Kinematics}
\rightarrow \mathrm{Inverse\ Dynamics}
\\
&\rightarrow \mathrm{Joint\ Torques}
\rightarrow \mathrm{Static\ Optimization/CMC}
\\
&\rightarrow \mathrm{Muscle\ Activation}
\rightarrow \mathrm{Muscle\ Dynamics}
\\
&\rightarrow \mathrm{Metabolic\ Model\ (Umberger)}
\rightarrow \mathrm{kcal}
\end{aligned}
$$
